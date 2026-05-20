import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';

/**
 * Minimal S3/MinIO client written against the AWS Sig V4 path-style API.
 * We avoid pulling the entire @aws-sdk/* dependency tree for Phase 2;
 * if Phase 6 adds presigned URLs, multi-part uploads, or CDN integration
 * we will swap to the official SDK.
 */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private endpoint: string;
  private publicEndpoint: string;
  private accessKey: string;
  private secretKey: string;
  private bucket: string;
  private region = 'us-east-1';

  constructor(private readonly cfg: ConfigService) {
    this.endpoint = (this.cfg.get<string>('MINIO_ENDPOINT') ?? 'http://localhost:9000').replace(/\/$/, '');
    this.publicEndpoint = (this.cfg.get<string>('MINIO_PUBLIC_ENDPOINT') ?? this.endpoint).replace(/\/$/, '');
    this.accessKey = this.cfg.get<string>('MINIO_ACCESS_KEY') ?? 'onsective';
    this.secretKey = this.cfg.get<string>('MINIO_SECRET_KEY') ?? 'onsective-secret';
    this.bucket = this.cfg.get<string>('MINIO_BUCKET') ?? 'onsective-media';
  }

  async onModuleInit() {
    try {
      await this.ensureBucket();
    } catch (e) {
      this.logger.warn(`MinIO bucket ensure skipped: ${(e as Error).message}`);
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.signedRequest('PUT', key, body, { 'content-type': contentType });
    if (!res.ok) throw new Error(`MinIO put failed: ${res.status}`);
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.signedRequest('GET', key);
    if (!res.ok) throw new Error(`MinIO get failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Return a 5-minute presigned GET URL using SigV4. */
  presignGetUrl(key: string, ttlSec = 300): string {
    return this.presignUrl('GET', key, ttlSec);
  }

  /** Return a 5-minute presigned PUT URL so clients can upload directly to MinIO. */
  presignPutUrl(key: string, ttlSec = 300): string {
    return this.presignUrl('PUT', key, ttlSec);
  }

  private presignUrl(method: 'GET' | 'PUT', key: string, ttlSec: number): string {
    const url = new URL(`${this.publicEndpoint}/${this.bucket}/${encodeURI(key)}`);
    const now = new Date();
    const amzDate = this.toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Credential', `${this.accessKey}/${credentialScope}`);
    url.searchParams.set('X-Amz-Date', amzDate);
    url.searchParams.set('X-Amz-Expires', String(ttlSec));
    url.searchParams.set('X-Amz-SignedHeaders', 'host');
    const canonicalQuery = Array.from(url.searchParams.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonicalRequest = [
      method,
      `/${this.bucket}/${encodeURI(key).split('/').map(encodeURIComponent).join('/')}`,
      canonicalQuery,
      `host:${url.host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signature = this.deriveSignature(dateStamp, stringToSign);
    url.searchParams.set('X-Amz-Signature', signature);
    return url.toString();
  }

  private async ensureBucket() {
    const headUrl = `${this.endpoint}/${this.bucket}`;
    const head = await fetch(headUrl, { method: 'HEAD' });
    if (head.status === 200 || head.status === 403) return;
    const res = await this.signedRequest('PUT', '', undefined, {}, { bucketLevel: true });
    if (!res.ok && res.status !== 409) throw new Error(`Bucket create failed: ${res.status}`);
  }

  private async signedRequest(
    method: 'PUT' | 'GET' | 'DELETE' | 'POST',
    key: string,
    body?: Buffer,
    extraHeaders: Record<string, string> = {},
    opts: { bucketLevel?: boolean } = {},
  ): Promise<Response> {
    const path = opts.bucketLevel ? `/${this.bucket}` : `/${this.bucket}/${key}`;
    const url = new URL(this.endpoint + path);
    const payloadHash = body
      ? createHash('sha256').update(body).digest('hex')
      : createHash('sha256').update('').digest('hex');
    const now = new Date();
    const amzDate = this.toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      ...extraHeaders,
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const signedHeaderNames = Object.keys(headers).map((k) => k.toLowerCase()).sort();
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]?.trim()}\n`).join('');
    const canonicalRequest = [
      method,
      url.pathname.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/'),
      '',
      canonicalHeaders,
      signedHeaderNames.join(';'),
      payloadHash,
    ].join('\n');
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signature = this.deriveSignature(dateStamp, stringToSign);
    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;
    return fetch(url, { method, headers, body });
  }

  private deriveSignature(dateStamp: string, stringToSign: string): string {
    const kDate = createHmac('sha256', `AWS4${this.secretKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(this.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    return createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  }

  private toAmzDate(d: Date): string {
    return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }
}

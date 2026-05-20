import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import type {
  TwoFactorChallengeKind,
  WebAuthnCredential,
  WebAuthnCredentialTransport,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { newId } from '../../common/id';
import { decodeCbor, type CborValue } from './cbor';
import { parseAuthData, flagUserPresent, flagUserVerified } from './authdata';
import { parseCoseKey, verifyAssertion } from './cose';

/**
 * Hand-rolled WebAuthn server. We support registration + assertion for
 * ES256, RS256, EdDSA. Attestation fmt is only inspected for fmt=`none`
 * vs everything-else (we accept either, but we DO verify the signature
 * is consistent with the credential's public key at assertion time).
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const CHALLENGE_REGISTER: TwoFactorChallengeKind = 'WEBAUTHN_REGISTER';
const CHALLENGE_LOGIN: TwoFactorChallengeKind = 'WEBAUTHN_LOGIN';

export interface ActorMeta {
  actorUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RegisterOptionsResult {
  publicKey: {
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    challenge: string; // base64url
    pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
    timeout: number;
    attestation: 'none';
    authenticatorSelection: {
      residentKey: 'preferred' | 'required' | 'discouraged';
      userVerification: 'preferred' | 'required' | 'discouraged';
    };
    excludeCredentials: Array<{
      type: 'public-key';
      id: string;
      transports?: string[];
    }>;
  };
  challenge: string; // opaque server token (different from the random bytes the browser sees)
}

export interface LoginOptionsResult {
  publicKey: {
    challenge: string; // base64url
    rpId: string;
    timeout: number;
    userVerification: 'preferred' | 'required' | 'discouraged';
    allowCredentials: Array<{
      type: 'public-key';
      id: string;
      transports?: string[];
    }>;
  };
  challenge: string; // opaque server token
}

export interface RegisterVerifyInput {
  challenge: string;
  credentialId: string;
  clientDataJSON: string;
  attestationObject: string;
  transports?: string[];
  label: string;
}

export interface LoginVerifyInput {
  challenge: string;
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string | null;
}

export interface VerifySuccess {
  userId: string;
  credentialId: string;
  userVerified: boolean;
}

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cfg: ConfigService,
  ) {}

  // ─────────────────────────── Config ───────────────────────────

  get rpId(): string {
    return this.cfg.get<string>('WEBAUTHN_RP_ID') ?? 'localhost';
  }
  get rpName(): string {
    return this.cfg.get<string>('WEBAUTHN_RP_NAME') ?? 'Onsective';
  }
  private get allowedOrigins(): string[] {
    const raw = this.cfg.get<string>('WEBAUTHN_ORIGINS');
    if (raw) return raw.split(',').map((s) => s.trim()).filter(Boolean);
    return ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'];
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private b64u(buf: Buffer): string {
    return buf.toString('base64url');
  }

  private fromB64u(s: string): Buffer {
    return Buffer.from(s, 'base64url');
  }

  // ─────────────────────────── Registration ───────────────────────────

  async registerOptions(userId: string, label: string): Promise<RegisterOptionsResult> {
    if (!label || label.length > 64) {
      throw new BadRequestException('Label must be 1–64 characters');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { webauthnCredentials: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.webauthnCredentials.length >= 10) {
      throw new ConflictException('Maximum 10 passkeys per account. Remove one to add another.');
    }

    // Opaque server-side token: 32 bytes of CSPRNG output that the client
    // hands back at verify-time. The WebAuthn challenge bytes the authenticator
    // signs over are derived deterministically as sha256("webauthn-reg::" || opaque).
    // This avoids a second persistence column for the raw bytes — the opaque
    // token *is* the entropy source, hashed to produce the spec-required random.
    const opaque = randomBytes(32).toString('base64url');
    await this.prisma.twoFactorChallenge.create({
      data: {
        id: newId(),
        userId,
        kind: CHALLENGE_REGISTER,
        tokenHash: this.hashToken(opaque),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });

    const webauthnChallenge = createHash('sha256')
      .update(`webauthn-reg::${opaque}`)
      .digest();

    return {
      publicKey: {
        rp: { id: this.rpId, name: this.rpName },
        user: {
          // The user.id field must be a byte string; we use the user's database id.
          id: this.b64u(Buffer.from(user.id, 'utf8')),
          name: user.email,
          displayName: `${user.firstName} ${user.lastName}`.trim() || user.email,
        },
        challenge: this.b64u(webauthnChallenge),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
          { type: 'public-key', alg: -8 }, // EdDSA
        ],
        timeout: 60_000,
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        excludeCredentials: user.webauthnCredentials.map((c) => ({
          type: 'public-key' as const,
          id: c.credentialId,
          transports: c.transports.map((t) => t.toLowerCase()),
        })),
      },
      challenge: opaque,
    };
  }

  async registerVerify(
    userId: string,
    input: RegisterVerifyInput,
    meta: ActorMeta,
  ): Promise<{ id: string; label: string; createdAt: Date }> {
    const challengeRow = await this.consumeChallenge(input.challenge, CHALLENGE_REGISTER);
    if (challengeRow.userId !== userId) {
      throw new UnauthorizedException('Challenge user mismatch');
    }

    const expectedChallenge = createHash('sha256')
      .update(`webauthn-reg::${input.challenge}`)
      .digest();

    const clientData = this.parseClientData(input.clientDataJSON, 'webauthn.create', expectedChallenge);
    void clientData;

    const attObj = decodeCbor(this.fromB64u(input.attestationObject));
    if (!attObj || typeof attObj !== 'object' || Array.isArray(attObj) || Buffer.isBuffer(attObj)) {
      throw new BadRequestException('Bad attestationObject');
    }
    const authDataBuf = (attObj as Record<string, CborValue>)['authData'];
    if (!Buffer.isBuffer(authDataBuf)) {
      throw new BadRequestException('Missing authData');
    }
    const authData = parseAuthData(authDataBuf);

    if (!flagUserPresent(authData.flags)) {
      throw new BadRequestException('User presence not asserted');
    }
    const expectedRpHash = createHash('sha256').update(this.rpId).digest();
    if (!authData.rpIdHash.equals(expectedRpHash)) {
      throw new BadRequestException('RP ID hash mismatch');
    }
    if (!authData.credentialId || !authData.publicKey) {
      throw new BadRequestException('Missing attested credential data');
    }

    const credentialIdB64 = this.b64u(authData.credentialId);

    // Reject if this credentialId is already registered to anyone.
    const dup = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: credentialIdB64 },
    });
    if (dup) {
      throw new ConflictException('This passkey is already registered');
    }

    const parsedKey = parseCoseKey(authData.publicKey);
    // Sanity — try a no-op verify-prepare to make sure the key actually loads
    // (covered by parseCoseKey's createPublicKey call, but be explicit).
    void parsedKey;

    const transports = (input.transports ?? [])
      .map((t) => t.toUpperCase())
      .filter((t): t is WebAuthnCredentialTransport =>
        ['USB', 'NFC', 'BLE', 'INTERNAL', 'HYBRID'].includes(t),
      );

    const created = await this.prisma.webAuthnCredential.create({
      data: {
        id: newId(),
        userId,
        credentialId: credentialIdB64,
        publicKey: this.b64u(authData.publicKey),
        algorithm: parsedKey.alg,
        signCount: authData.signCount,
        label: input.label.trim(),
        transports,
        discoverable: false, // we can't tell from the response alone; set true later if needed
        userVerified: flagUserVerified(authData.flags),
        aaguid: authData.aaguid?.toString('hex') ?? null,
      },
    });

    // First passkey enrollment turns on twoFactorEnabled so the login flow
    // demands a second factor. If TOTP is already on, this is a no-op.
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    await this.audit
      .record({
        actorUserId: meta.actorUserId ?? userId,
        action: 'webauthn.credential.registered',
        entityType: 'User',
        entityId: userId,
        after: { credentialId: credentialIdB64, alg: parsedKey.alg, label: created.label },
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch((e) => this.logger.warn(`audit webauthn.registered failed: ${e}`));

    return { id: created.id, label: created.label, createdAt: created.createdAt };
  }

  // ─────────────────────────── Login (passwordless) ───────────────────────────

  async loginOptions(email?: string | null): Promise<LoginOptionsResult> {
    let userId: string | null = null;
    let allowCredentials: WebAuthnCredential[] = [];
    if (email) {
      const user = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        include: { webauthnCredentials: true },
      });
      if (user) {
        userId = user.id;
        allowCredentials = user.webauthnCredentials;
      }
    }

    const opaque = randomBytes(32).toString('base64url');
    await this.prisma.twoFactorChallenge.create({
      data: {
        id: newId(),
        // userId is required by the schema; for discoverable-credential login
        // we don't yet know the user — store a placeholder that we'll re-key
        // at verify-time. To keep schema FK valid, we use the email-resolved
        // userId or a synthetic anchor user; the cleanest approach is to
        // anchor to whatever user we resolved (if email matched) or to NULL
        // — but FK requires non-null. We resolve this by requiring email
        // for now: if no email, no allowCredentials (browser picks), but
        // we still need a user anchor. For discoverable flow we DON'T
        // store a user-bound challenge; we store with a sentinel user.
        userId: userId ?? (await this.systemAnchorUserId()),
        kind: CHALLENGE_LOGIN,
        tokenHash: this.hashToken(opaque),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });

    const webauthnChallenge = createHash('sha256')
      .update(`webauthn-login::${opaque}`)
      .digest();

    return {
      publicKey: {
        challenge: this.b64u(webauthnChallenge),
        rpId: this.rpId,
        timeout: 60_000,
        userVerification: 'preferred',
        allowCredentials: allowCredentials.map((c) => ({
          type: 'public-key' as const,
          id: c.credentialId,
          transports: c.transports.map((t) => t.toLowerCase()),
        })),
      },
      challenge: opaque,
    };
  }

  async loginVerify(input: LoginVerifyInput, meta: ActorMeta): Promise<VerifySuccess> {
    const challengeRow = await this.consumeChallenge(input.challenge, CHALLENGE_LOGIN);

    const expectedChallenge = createHash('sha256')
      .update(`webauthn-login::${input.challenge}`)
      .digest();
    this.parseClientData(input.clientDataJSON, 'webauthn.get', expectedChallenge);

    const credential = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: input.credentialId },
    });
    if (!credential) throw new UnauthorizedException('Unknown credential');

    // If the challenge was minted against a specific user (email-first flow),
    // ensure the credential belongs to that user. Discoverable flow has the
    // system anchor user — we accept any matching credential there.
    const anchorUserId = await this.systemAnchorUserId();
    if (challengeRow.userId !== anchorUserId && challengeRow.userId !== credential.userId) {
      throw new UnauthorizedException('Credential not allowed for this challenge');
    }

    const authData = parseAuthData(this.fromB64u(input.authenticatorData));
    if (!flagUserPresent(authData.flags)) {
      throw new UnauthorizedException('User presence not asserted');
    }
    const expectedRpHash = createHash('sha256').update(this.rpId).digest();
    if (!authData.rpIdHash.equals(expectedRpHash)) {
      throw new UnauthorizedException('RP ID hash mismatch');
    }

    // Counter must strictly increase. Apple platform authenticators always
    // emit 0 — we permit it when stored is also 0, otherwise reject.
    if (authData.signCount !== 0 || credential.signCount !== 0) {
      if (authData.signCount <= credential.signCount) {
        this.logger.warn(
          `webauthn counter regression cred=${credential.id} stored=${credential.signCount} got=${authData.signCount}`,
        );
        throw new UnauthorizedException('Authenticator counter regression');
      }
    }

    const cose = parseCoseKey(this.fromB64u(credential.publicKey));
    const clientDataHash = createHash('sha256').update(this.fromB64u(input.clientDataJSON)).digest();
    const ok = verifyAssertion(
      cose.alg,
      cose.key,
      this.fromB64u(input.authenticatorData),
      clientDataHash,
      this.fromB64u(input.signature),
    );
    if (!ok) throw new UnauthorizedException('Signature verification failed');

    await this.prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: {
        signCount: authData.signCount,
        lastUsedAt: new Date(),
        userVerified: flagUserVerified(authData.flags) || credential.userVerified,
      },
    });

    await this.audit
      .record({
        actorUserId: credential.userId,
        action: 'webauthn.assertion.verified',
        entityType: 'User',
        entityId: credential.userId,
        after: { credentialId: credential.credentialId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch((e) => this.logger.warn(`audit webauthn.verified failed: ${e}`));

    return {
      userId: credential.userId,
      credentialId: credential.credentialId,
      userVerified: flagUserVerified(authData.flags),
    };
  }

  // ─────────────────────────── Credential management ───────────────────────────

  async listCredentials(userId: string) {
    const rows = await this.prisma.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      algorithm: r.algorithm,
      transports: r.transports,
      userVerified: r.userVerified,
    }));
  }

  async removeCredential(userId: string, id: string, meta: ActorMeta) {
    const row = await this.prisma.webAuthnCredential.findUnique({ where: { id } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Passkey not found');
    }
    await this.prisma.webAuthnCredential.delete({ where: { id } });
    await this.audit
      .record({
        actorUserId: meta.actorUserId ?? userId,
        action: 'webauthn.credential.removed',
        entityType: 'User',
        entityId: userId,
        before: { credentialId: row.credentialId, label: row.label },
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch((e) => this.logger.warn(`audit webauthn.removed failed: ${e}`));
    return { ok: true as const };
  }

  async adminReset(targetUserId: string, actor: ActorMeta) {
    await this.prisma.webAuthnCredential.deleteMany({ where: { userId: targetUserId } });
    await this.audit
      .record({
        actorUserId: actor.actorUserId,
        action: 'webauthn.admin_reset',
        entityType: 'User',
        entityId: targetUserId,
        ip: actor.ip,
        userAgent: actor.userAgent,
      })
      .catch((e) => this.logger.warn(`audit webauthn.admin_reset failed: ${e}`));
    return { ok: true as const };
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private async consumeChallenge(rawToken: string, expectKind: TwoFactorChallengeKind) {
    const row = await this.prisma.twoFactorChallenge.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });
    if (!row) throw new UnauthorizedException('Challenge not found');
    if (row.consumedAt) throw new UnauthorizedException('Challenge already used');
    if (row.expiresAt < new Date()) throw new UnauthorizedException('Challenge expired');
    if (row.kind !== expectKind) throw new UnauthorizedException('Challenge kind mismatch');
    await this.prisma.twoFactorChallenge.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return row;
  }

  private parseClientData(b64: string, expectedType: string, expectedChallenge: Buffer) {
    const raw = this.fromB64u(b64).toString('utf8');
    let json: { type: string; challenge: string; origin: string };
    try {
      json = JSON.parse(raw);
    } catch {
      throw new BadRequestException('Bad clientDataJSON');
    }
    if (json.type !== expectedType) {
      throw new BadRequestException(`Bad type: ${json.type}`);
    }
    const seenChallenge = this.fromB64u(json.challenge);
    if (!seenChallenge.equals(expectedChallenge)) {
      throw new UnauthorizedException('Challenge mismatch');
    }
    if (!this.allowedOrigins.includes(json.origin)) {
      throw new UnauthorizedException(`Bad origin: ${json.origin}`);
    }
    return json;
  }

  /**
   * Anchor user for discoverable-credential challenges (where we don't know
   * the user until the assertion arrives). We use a deterministic synthetic
   * user with a fixed ID; if it doesn't exist we create it on first call.
   * Foreign-key constraint is satisfied without leaking any real user data.
   */
  private cachedAnchorId: string | null = null;
  private async systemAnchorUserId(): Promise<string> {
    if (this.cachedAnchorId) return this.cachedAnchorId;
    const anchorId = 'u_system_webauthn_anchor';
    const existing = await this.prisma.user.findUnique({ where: { id: anchorId } });
    if (!existing) {
      await this.prisma.user.create({
        data: {
          id: anchorId,
          email: 'webauthn-anchor@onsective.local',
          passwordHash: '', // login blocked — Phase 26 logic refuses empty passwordHash
          firstName: 'WebAuthn',
          lastName: 'Anchor',
          role: 'BUYER',
          status: 'SUSPENDED',
        },
      });
    }
    this.cachedAnchorId = anchorId;
    return anchorId;
  }
}

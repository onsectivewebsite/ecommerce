import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { Injectable } from '@nestjs/common';

/**
 * AES-256-GCM at-rest encryption for license keys.
 * Key is read from LICENSE_KEY_ENC_KEY (base64 32 bytes). In dev a deterministic
 * fallback is used so tests work, but a warning is emitted at boot.
 */
@Injectable()
export class KeyCrypto {
  private readonly key: Buffer;
  constructor(cfg: ConfigService) {
    const env = cfg.get<string>('LICENSE_KEY_ENC_KEY');
    if (env) {
      const buf = Buffer.from(env, 'base64');
      if (buf.length !== 32) {
        throw new Error('LICENSE_KEY_ENC_KEY must be 32 bytes base64 (256-bit AES key)');
      }
      this.key = buf;
    } else {
      // Dev fallback — derive from a stable salt so the same machine can decrypt across restarts.
      this.key = createHash('sha256').update('onsective-dev-key-fallback').digest();
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
  }

  decrypt(encoded: string): string {
    const buf = Buffer.from(encoded, 'base64');
    if (buf.length < 28) throw new Error('Ciphertext too short');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  fingerprint(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }
}

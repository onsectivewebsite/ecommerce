import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * AES-256-GCM at-rest encryption for TOTP secrets.
 *
 * Key derivation:
 *  - Reads TWO_FACTOR_ENC_KEY env (base64 of 32 raw bytes).
 *  - In dev (no env set), derives a deterministic key from JWT_ACCESS_SECRET
 *    so the same dev DB stays decryptable across restarts. NEVER ship to
 *    production without TWO_FACTOR_ENC_KEY set — we throw if NODE_ENV is
 *    'production' and the env is missing.
 *
 * Format on disk:
 *   secretCipher = base64(ciphertext)
 *   secretIv     = base64(12-byte iv)
 *   secretTag    = base64(16-byte gcm auth tag)
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TWO_FACTOR_ENC_KEY;
  if (raw) {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new Error('TWO_FACTOR_ENC_KEY must decode to exactly 32 bytes');
    }
    cachedKey = buf;
    return buf;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TWO_FACTOR_ENC_KEY is required in production');
  }
  // Dev fallback — deterministic per JWT secret so restarts keep working.
  const seed = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret';
  cachedKey = createHash('sha256').update(`ons-2fa-key::${seed}`).digest();
  return cachedKey;
}

export function encryptSecret(secret: Buffer): {
  cipher: string;
  iv: string;
  tag: string;
} {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([c.update(secret), c.final()]);
  const tag = c.getAuthTag();
  return {
    cipher: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret(input: {
  cipher: string;
  iv: string;
  tag: string;
}): Buffer {
  const key = loadKey();
  const iv = Buffer.from(input.iv, 'base64');
  const tag = Buffer.from(input.tag, 'base64');
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('TOTP secret has malformed iv/tag');
  }
  const d = createDecipheriv(ALGO, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([
    d.update(Buffer.from(input.cipher, 'base64')),
    d.final(),
  ]);
}

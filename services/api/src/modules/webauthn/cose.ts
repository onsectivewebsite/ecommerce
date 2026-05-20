import { createPublicKey, createVerify, KeyObject, verify as nodeVerify } from 'crypto';
import { decodeCbor, type CborValue } from './cbor';

/**
 * Parse a COSE_Key (RFC 8152) into a Node `KeyObject` we can hand to
 * `crypto.verify()`. We support the three algorithms WebAuthn deploys
 * in 2025+: ES256 (-7), RS256 (-257), EdDSA (-8).
 *
 * Approach: each algorithm has a well-known SubjectPublicKeyInfo DER
 * encoding that wraps the raw key bytes. We hand-build the DER prefix
 * (constant per algorithm) and let Node parse the rest.
 *
 * Why not JWK-import? Avoids a serialization round-trip and the chance
 * of a future Node version disagreeing about JWK shape.
 */

export const COSE_ALG_ES256 = -7;
export const COSE_ALG_RS256 = -257;
export const COSE_ALG_EDDSA = -8;

// COSE_Key map labels. Used as numeric keys in the CBOR map.
const COSE_KTY = 1;
const COSE_ALG = 3;
// EC2 / OKP keys
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;
// RSA keys
const COSE_N = -1;
const COSE_E = -2;

const COSE_KTY_EC2 = 2;
const COSE_KTY_RSA = 3;
const COSE_KTY_OKP = 1;

const COSE_CRV_P256 = 1;
const COSE_CRV_ED25519 = 6;

export interface ParsedCose {
  alg: number;
  key: KeyObject;
}

export function parseCoseKey(cose: Buffer): ParsedCose {
  const decoded = decodeCbor(cose);
  if (!isMap(decoded)) throw new Error('COSE: top-level must be a map');
  const kty = numAt(decoded, COSE_KTY);
  const alg = numAt(decoded, COSE_ALG);

  if (kty === COSE_KTY_EC2 && alg === COSE_ALG_ES256) {
    const crv = numAt(decoded, COSE_CRV);
    if (crv !== COSE_CRV_P256) {
      throw new Error(`COSE: unsupported EC curve ${crv}`);
    }
    const x = bytesAt(decoded, COSE_X);
    const y = bytesAt(decoded, COSE_Y);
    if (x.length !== 32 || y.length !== 32) {
      throw new Error('COSE: ES256 x/y must be 32 bytes each');
    }
    return { alg, key: buildEcP256Key(x, y) };
  }

  if (kty === COSE_KTY_RSA && alg === COSE_ALG_RS256) {
    const n = bytesAt(decoded, COSE_N);
    const e = bytesAt(decoded, COSE_E);
    return { alg, key: buildRsaKey(n, e) };
  }

  if (kty === COSE_KTY_OKP && alg === COSE_ALG_EDDSA) {
    const crv = numAt(decoded, COSE_CRV);
    if (crv !== COSE_CRV_ED25519) {
      throw new Error(`COSE: unsupported OKP curve ${crv}`);
    }
    const x = bytesAt(decoded, COSE_X);
    if (x.length !== 32) throw new Error('COSE: Ed25519 x must be 32 bytes');
    return { alg, key: buildEd25519Key(x) };
  }

  throw new Error(`COSE: unsupported key type ${kty} / alg ${alg}`);
}

/**
 * Verify a WebAuthn assertion signature. Inputs:
 *  - alg: COSE algorithm identifier
 *  - publicKey: Node KeyObject from parseCoseKey
 *  - authenticatorData + clientDataHash → signature is over their concat
 *  - signature: as received from the authenticator (raw bytes)
 *
 * For ES256 the signature is DER-encoded (Sequence(r,s)); we feed it
 * directly to Node's verifier, which accepts DER.
 */
export function verifyAssertion(
  alg: number,
  publicKey: KeyObject,
  authenticatorData: Buffer,
  clientDataHash: Buffer,
  signature: Buffer,
): boolean {
  const signedData = Buffer.concat([authenticatorData, clientDataHash]);
  if (alg === COSE_ALG_ES256) {
    const v = createVerify('sha256');
    v.update(signedData);
    v.end();
    return v.verify({ key: publicKey, dsaEncoding: 'der' }, signature);
  }
  if (alg === COSE_ALG_RS256) {
    const v = createVerify('sha256');
    v.update(signedData);
    v.end();
    return v.verify(publicKey, signature);
  }
  if (alg === COSE_ALG_EDDSA) {
    // Ed25519 has no separate hash step; pass null as the algorithm.
    return nodeVerify(null, signedData, publicKey, signature);
  }
  throw new Error(`COSE: cannot verify alg ${alg}`);
}

// ─────────────────────────── DER builders ───────────────────────────

function buildEcP256Key(x: Buffer, y: Buffer): KeyObject {
  // SubjectPublicKeyInfo for ECDSA P-256 = constant prefix || 0x04 || x || y
  // Prefix encodes: SEQUENCE { SEQUENCE { OID ecPublicKey, OID prime256v1 } BIT STRING (uncompressed) }
  const prefix = Buffer.from(
    '3059301306072a8648ce3d020106082a8648ce3d03010703420004',
    'hex',
  );
  const der = Buffer.concat([prefix, x, y]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function buildEd25519Key(x: Buffer): KeyObject {
  // SubjectPublicKeyInfo for Ed25519 = constant prefix || x
  // SEQUENCE { SEQUENCE { OID Ed25519 } BIT STRING (raw 32 bytes) }
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([prefix, x]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function buildRsaKey(modulus: Buffer, exponent: Buffer): KeyObject {
  // PKCS#1 RSAPublicKey: SEQUENCE { INTEGER modulus, INTEGER exponent }
  // SPKI wraps: SEQUENCE { SEQUENCE { OID rsaEncryption, NULL } BIT STRING (RSAPublicKey) }
  const n = derInteger(modulus);
  const e = derInteger(exponent);
  const rsaPub = wrap(0x30, Buffer.concat([n, e]));
  const bitString = Buffer.concat([Buffer.from([0x00]), rsaPub]);
  const wrappedBitString = wrap(0x03, bitString);
  const algorithmIdentifier = Buffer.from('300d06092a864886f70d0101010500', 'hex');
  const spki = wrap(0x30, Buffer.concat([algorithmIdentifier, wrappedBitString]));
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

function derInteger(raw: Buffer): Buffer {
  // INTEGER: prepend 0x00 if high bit is set so it's interpreted as positive.
  const needsPad = ((raw[0] ?? 0) & 0x80) !== 0;
  const body = needsPad ? Buffer.concat([Buffer.from([0x00]), raw]) : raw;
  return wrap(0x02, body);
}

function wrap(tag: number, body: Buffer): Buffer {
  const len = encodeDerLength(body.length);
  return Buffer.concat([Buffer.from([tag]), len, body]);
}

function encodeDerLength(len: number): Buffer {
  if (len < 128) return Buffer.from([len]);
  if (len < 256) return Buffer.from([0x81, len]);
  if (len < 65536) return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  if (len < 16777216) return Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  throw new Error('DER: length too large');
}

// ─────────────────────────── CBOR helpers ───────────────────────────

function isMap(v: CborValue): v is { [k: string]: CborValue; [k: number]: CborValue } {
  return typeof v === 'object' && v !== null && !Buffer.isBuffer(v) && !Array.isArray(v) && !(v instanceof Map);
}

function numAt(obj: { [k: number]: CborValue }, key: number): number {
  const v = obj[key];
  if (typeof v !== 'number' && typeof v !== 'bigint') {
    throw new Error(`COSE: missing or non-numeric key ${key}`);
  }
  return Number(v);
}

function bytesAt(obj: { [k: number]: CborValue }, key: number): Buffer {
  const v = obj[key];
  if (!Buffer.isBuffer(v)) throw new Error(`COSE: missing or non-byte key ${key}`);
  return v;
}

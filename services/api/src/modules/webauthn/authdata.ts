import { decodeFirst } from './cbor';

/**
 * Parse a WebAuthn `authenticatorData` byte string per WebAuthn L3 §6.1.
 * Layout (big-endian):
 *
 *   rpIdHash         32 bytes
 *   flags             1 byte
 *   signCount         4 bytes (uint32)
 *   attestedCredentialData (present iff flags.AT)
 *     aaguid          16 bytes
 *     credIdLen        2 bytes
 *     credentialId    credIdLen bytes
 *     publicKey       remaining CBOR bytes (COSE_Key)
 *   extensions (CBOR, present iff flags.ED) — ignored
 */

export const FLAG_UP = 0x01; // user present
export const FLAG_UV = 0x04; // user verified
export const FLAG_BE = 0x08; // backup eligible
export const FLAG_BS = 0x10; // backup state
export const FLAG_AT = 0x40; // attested credential data
export const FLAG_ED = 0x80; // extension data

export interface AuthData {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  aaguid?: Buffer;
  credentialId?: Buffer;
  publicKey?: Buffer;
}

export function parseAuthData(buf: Buffer): AuthData {
  if (buf.length < 37) {
    throw new Error(`authData: too short (${buf.length})`);
  }
  const rpIdHash = Buffer.from(buf.subarray(0, 32));
  const flags = buf[32]!; // guarded by the length check above
  const signCount = buf.readUInt32BE(33);

  const out: AuthData = { rpIdHash, flags, signCount };

  if ((flags & FLAG_AT) !== 0) {
    let offset = 37;
    if (buf.length < offset + 18) {
      throw new Error('authData: AT set but truncated');
    }
    out.aaguid = Buffer.from(buf.subarray(offset, offset + 16));
    offset += 16;
    const credIdLen = buf.readUInt16BE(offset);
    offset += 2;
    if (buf.length < offset + credIdLen) {
      throw new Error('authData: credentialId truncated');
    }
    out.credentialId = Buffer.from(buf.subarray(offset, offset + credIdLen));
    offset += credIdLen;
    // The rest of the buffer is the COSE_Key CBOR-encoded (and optionally
    // followed by an extensions map when FLAG_ED is set). We decode the
    // first CBOR item to find where the publicKey ends.
    const [, pkEnd] = decodeFirst(buf, offset);
    out.publicKey = Buffer.from(buf.subarray(offset, pkEnd));
  }

  return out;
}

export function flagUserPresent(flags: number): boolean {
  return (flags & FLAG_UP) !== 0;
}

export function flagUserVerified(flags: number): boolean {
  return (flags & FLAG_UV) !== 0;
}

/**
 * Minimal CBOR decoder for the subset WebAuthn uses.
 *
 * WebAuthn only emits these CBOR types in `attestationObject` and COSE keys:
 *  - unsigned/negative ints (major 0, 1)
 *  - byte strings (major 2)
 *  - text strings (major 3)
 *  - arrays (major 4)
 *  - maps (major 5)
 *
 * We don't need tags, floats, or indefinite-length items. The decoder
 * intentionally rejects anything we don't expect rather than silently
 * recover — WebAuthn payloads are well-defined and any drift means a
 * malformed input we shouldn't be trusting.
 *
 * Hand-rolled rather than pulling `cbor` from npm: small surface, deterministic,
 * no transitive deps, no risk of supply-chain surprise on an auth path.
 */

export type CborValue =
  | number
  | bigint
  | string
  | Buffer
  | CborValue[]
  | { [k: string]: CborValue; [k: number]: CborValue }
  | Map<number | string, CborValue>;

export function decodeCbor(buf: Buffer): CborValue {
  const [value, offset] = decodeAt(buf, 0);
  if (offset !== buf.length) {
    // Some inputs (authData) embed multiple structures back-to-back; callers
    // should use decodeFirst when that's expected. Top-level decodeCbor
    // requires consuming the whole buffer.
    throw new Error(`CBOR: trailing ${buf.length - offset} bytes`);
  }
  return value;
}

/**
 * Decode the first CBOR item and return both the value and the byte offset
 * just past it. Used when we need to peel a single map off a larger buffer
 * (e.g. attestationObject sits at the front of an attestation payload).
 */
export function decodeFirst(buf: Buffer, offset = 0): [CborValue, number] {
  return decodeAt(buf, offset);
}

function decodeAt(buf: Buffer, offset: number): [CborValue, number] {
  if (offset >= buf.length) throw new Error('CBOR: unexpected end of input');
  const initial = buf[offset]!; // guarded by the bounds check above
  const major = initial >> 5;
  const minor = initial & 0x1f;
  let [length, next] = readLength(buf, offset + 1, minor);

  switch (major) {
    case 0: // unsigned int
      return [Number(length), next];
    case 1: // negative int
      // length is the absolute value minus 1; result = -1 - length.
      // Use bigint when above safe integer range.
      if (typeof length === 'bigint') return [-(length + BigInt(1)), next];
      return [-1 - Number(length), next];
    case 2: {
      // byte string
      const len = Number(length);
      if (next + len > buf.length) throw new Error('CBOR: byte string overflow');
      const slice = buf.subarray(next, next + len);
      // Return a Buffer copy so the underlying ArrayBuffer can be released.
      return [Buffer.from(slice), next + len];
    }
    case 3: {
      // text string
      const len = Number(length);
      if (next + len > buf.length) throw new Error('CBOR: text string overflow');
      const text = buf.subarray(next, next + len).toString('utf8');
      return [text, next + len];
    }
    case 4: {
      // array
      const len = Number(length);
      const out: CborValue[] = [];
      let cur = next;
      for (let i = 0; i < len; i++) {
        const [v, n] = decodeAt(buf, cur);
        out.push(v);
        cur = n;
      }
      return [out, cur];
    }
    case 5: {
      // map — keys can be int or text. We return a plain object keyed by
      // the JS-stringified key for ergonomics, but ALSO preserve numeric
      // keys natively so COSE keys (which use ints) work cleanly.
      const len = Number(length);
      const obj: { [k: string]: CborValue; [k: number]: CborValue } = Object.create(null);
      let cur = next;
      for (let i = 0; i < len; i++) {
        const [k, n1] = decodeAt(buf, cur);
        const [v, n2] = decodeAt(buf, n1);
        if (typeof k === 'number' || typeof k === 'string') {
          obj[k as never] = v;
        } else {
          throw new Error(`CBOR: unsupported map key type ${typeof k}`);
        }
        cur = n2;
      }
      return [obj, cur];
    }
    default:
      throw new Error(`CBOR: unsupported major type ${major}`);
  }
}

function readLength(buf: Buffer, offset: number, minor: number): [number | bigint, number] {
  if (minor < 24) return [minor, offset];
  if (minor === 24) {
    if (offset + 1 > buf.length) throw new Error('CBOR: short read for 1-byte length');
    return [buf[offset]!, offset + 1];
  }
  if (minor === 25) {
    if (offset + 2 > buf.length) throw new Error('CBOR: short read for 2-byte length');
    return [buf.readUInt16BE(offset), offset + 2];
  }
  if (minor === 26) {
    if (offset + 4 > buf.length) throw new Error('CBOR: short read for 4-byte length');
    return [buf.readUInt32BE(offset), offset + 4];
  }
  if (minor === 27) {
    if (offset + 8 > buf.length) throw new Error('CBOR: short read for 8-byte length');
    return [buf.readBigUInt64BE(offset), offset + 8];
  }
  // 28..30 reserved, 31 indefinite — none expected in WebAuthn.
  throw new Error(`CBOR: unsupported additional info ${minor}`);
}

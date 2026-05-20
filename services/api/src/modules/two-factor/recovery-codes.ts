import { randomBytes } from 'crypto';

/**
 * Recovery codes use the same Crockford-base32-ish alphabet as referral codes:
 * no 0/O, no 1/I/L, no 8/B distinction issues. Format: XXXX-XXXX (4-4-dash).
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP_LEN = 4;
const GROUPS = 2;

export function generateRecoveryCode(): string {
  const total = GROUP_LEN * GROUPS;
  const bytes = randomBytes(total);
  const chars: string[] = [];
  for (let i = 0; i < total; i++) {
    chars.push(ALPHABET[bytes[i] % ALPHABET.length]);
  }
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    groups.push(chars.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN).join(''));
  }
  return groups.join('-');
}

/** Normalize user-submitted recovery code (uppercase, strip non-alphabet). */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((c) => ALPHABET.includes(c))
    .join('');
}

export function isWellFormedRecoveryCode(input: string): boolean {
  const norm = normalizeRecoveryCode(input);
  return norm.length === GROUP_LEN * GROUPS;
}

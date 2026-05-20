import type { Request } from 'express';
import type { ConsentRegion } from '@prisma/client';

/**
 * Best-effort region detection from CDN-supplied country header, then
 * Accept-Language, then a hard fallback. This is the bucketing the cookie
 * banner uses to decide default opt-in (EU/UK) vs default opt-out (REST).
 *
 * We deliberately do *not* re-detect on every request — region is captured
 * once at first consent and never re-bucketed. A user traveling from London
 * to NYC keeps their UK consent until they explicitly change it. That's
 * less surprising than silently weakening their protection.
 */

// Countries currently in the EU + EEA. ePrivacy applies broadly across these.
const EU_COUNTRIES = new Set<string>([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EEA non-EU
  'IS', 'LI', 'NO',
]);

function readCountry(req: Request): string | null {
  const headers = req.headers;
  // Cloudflare
  const cf = headers['cf-ipcountry'];
  if (typeof cf === 'string' && cf.length === 2) return cf.toUpperCase();
  // Vercel
  const vercel = headers['x-vercel-ip-country'];
  if (typeof vercel === 'string' && vercel.length === 2) return vercel.toUpperCase();
  // Fastly
  const fastly = headers['x-fastly-country'];
  if (typeof fastly === 'string' && fastly.length === 2) return fastly.toUpperCase();
  return null;
}

function readUsRegion(req: Request): string | null {
  // Cloudflare supplies cf-region with the US state code when origin is US.
  const v = req.headers['cf-region-code'] ?? req.headers['x-vercel-ip-country-region'];
  if (typeof v === 'string') return v.toUpperCase();
  return null;
}

function readAcceptLanguage(req: Request): string | null {
  const al = req.headers['accept-language'];
  if (typeof al !== 'string') return null;
  // first tag, e.g. "en-GB" → "GB"
  const first = al.split(',')[0]?.trim();
  if (!first) return null;
  const parts = first.split('-');
  if (parts.length < 2) return null;
  return parts[1].toUpperCase();
}

export function detectRegion(req: Request): ConsentRegion {
  const country = readCountry(req);
  if (country) {
    if (EU_COUNTRIES.has(country)) return 'EU';
    if (country === 'GB') return 'UK';
    if (country === 'US') {
      const state = readUsRegion(req);
      if (state === 'CA') return 'CA';
      return 'REST';
    }
    return 'REST';
  }
  const tag = readAcceptLanguage(req);
  if (tag) {
    if (EU_COUNTRIES.has(tag)) return 'EU';
    if (tag === 'GB') return 'UK';
  }
  return 'REST';
}

export function isOptInByDefault(region: ConsentRegion): boolean {
  return region === 'EU' || region === 'UK';
}

'use client';

import * as React from 'react';
import { Button, Card, CardDescription, Input } from '@onsective/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const COOKIE_NAME = 'onsective_age_ok';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

function writeCookie(name: string, value: string, expiresAt: Date) {
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expiresAt.toUTCString()}; path=/; SameSite=Lax`;
}

function localAgeFromCookie(): number | null {
  const raw = readCookie(COOKIE_NAME);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const age = Number(parts[0]);
  const exp = Number(parts[1]);
  if (!Number.isFinite(age) || !Number.isFinite(exp)) return null;
  if (Date.now() > exp) return null;
  return age;
}

function ensureSessionId(): string {
  if (typeof window === 'undefined') return '';
  const KEY = 'onsective_sid';
  let sid = window.localStorage.getItem(KEY);
  if (!sid) {
    sid = 'sid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(KEY, sid);
  }
  return sid;
}

interface Props {
  productId: string;
  productTitle: string;
  minAge: number;
  onPass(): void;
}

export function AgeGate({ productId, productTitle, minAge, onPass }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = React.useState(true);
  const [dob, setDob] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    const cookieAge = localAgeFromCookie();
    if (cookieAge != null && cookieAge >= minAge) {
      setOpen(false);
      onPass();
    }
  }, [minAge, onPass]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dob) return;
    setBusy(true);
    setErr(null);
    try {
      const sessionId = ensureSessionId();
      const result = user
        ? await api.compliance.submitAgeConsent({
            productId,
            dob,
            method: 'SELF_DECLARATION',
            sessionId,
          })
        : await api.compliance.submitAgeConsentGuest({
            productId,
            dob,
            method: 'SELF_DECLARATION',
            sessionId,
          });
      writeCookie(COOKIE_NAME, result.cookieValue, new Date(result.expiresAt));
      setOpen(false);
      onPass();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  // Move keyboard focus into the dialog when it opens, restore it when closed.
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    if (open) {
      headingRef.current?.focus();
      // Trap Escape so users can decline cleanly via keyboard.
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') window.location.href = '/';
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      className="fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <Card className="max-w-md w-full">
        <h2 id="age-gate-title" tabIndex={-1} ref={headingRef} className="font-display text-lg font-semibold">
          Age verification required
        </h2>
        <CardDescription>
          {productTitle} is restricted to buyers aged {minAge}+. Enter your date of birth to continue.
          Onsective stores only your declared age, not your date of birth shown here in full.
        </CardDescription>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Input
            label="Date of birth"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
            max={new Date().toISOString().slice(0, 10)}
            autoFocus
          />
          {err && <p role="alert" className="text-danger text-sm">{err}</p>}
          <div className="flex gap-3 justify-end">
            <a
              href="/"
              className="ons-btn px-3 py-2 text-sm border border-ink-700 bg-ink-900 hover:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              Leave page
            </a>
            <Button type="submit" loading={busy}>I am {minAge} or older</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

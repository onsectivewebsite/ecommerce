'use client';

import * as React from 'react';
import type { AnnouncementRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const LS_KEY = 'ons-dismissed-announcements';

const TONE: Record<AnnouncementRow['level'], string> = {
  INFO: 'bg-accent-500/15 text-accent-200 border-accent-500/30',
  SUCCESS: 'bg-success/15 text-success border-success/30',
  WARNING: 'bg-warning/15 text-warning border-warning/30',
};

function readLocalDismissed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeLocalDismissed(ids: string[]) {
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(ids)); }
  catch { /* ignore — private mode etc. */ }
}

export function AnnouncementBar() {
  const { user, loading } = useAuth();
  const [ann, setAnn] = React.useState<AnnouncementRow | null>(null);
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (loading) return;
    api.announcements
      .current()
      .then((row) => setAnn(row))
      .catch(() => setAnn(null));
    if (user) {
      api.announcements
        .myDismissals()
        .then((ids) => setDismissed(new Set(ids)))
        .catch(() => setDismissed(new Set()))
        .finally(() => setHydrated(true));
    } else {
      setDismissed(new Set(readLocalDismissed()));
      setHydrated(true);
    }
  }, [user, loading]);

  if (!hydrated || !ann || dismissed.has(ann.id)) return null;

  function dismiss() {
    if (!ann) return;
    const next = new Set(dismissed);
    next.add(ann.id);
    setDismissed(next);
    if (user) {
      api.announcements.dismiss(ann.id).catch(() => undefined);
    } else {
      writeLocalDismissed(Array.from(next));
    }
  }

  return (
    <div className={`border-b ${TONE[ann.level]}`}>
      <div className="container py-2 text-sm flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-medium">{ann.title}</span>
          <span className="mx-2 opacity-60">·</span>
          <span className="opacity-90">{ann.message}</span>
          {ann.linkUrl && (
            <a href={ann.linkUrl} className="ml-3 underline">
              {ann.linkLabel ?? 'Learn more'}
            </a>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={dismiss}
          className="opacity-70 hover:opacity-100 text-lg leading-none shrink-0"
        >
          ×
        </button>
      </div>
    </div>
  );
}

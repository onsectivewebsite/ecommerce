'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardDescription, CardTitle } from '@onsective/ui';
import type { DigitalDeliveryDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function DownloadsPage() {
  const { user, loading } = useAuth();
  const [items, setItems] = React.useState<DigitalDeliveryDto[] | null>(null);
  const [revealedKey, setRevealedKey] = React.useState<Record<string, string>>({});
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    if (!user) return;
    api.digital.listMyDeliveries().then(setItems).catch(() => setItems([]));
  }, [user]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function reveal(id: string) {
    setBusyId(id); setMsg(null);
    try {
      const { code } = await api.digital.revealKey(id);
      setRevealedKey((prev) => ({ ...prev, [id]: code }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not reveal key');
    } finally { setBusyId(null); }
  }

  async function download(id: string) {
    setBusyId(id); setMsg(null);
    try {
      const { url } = await api.digital.mintDownloadUrl(id);
      window.open(url, '_blank');
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Download failed');
    } finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 max-w-4xl space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Digital downloads</h1>
        <p className="text-ink-400 text-sm mt-1">
          License keys and downloads for digital goods you have purchased. Each download URL is one-shot and expires in 5 minutes.
        </p>
      </header>

      {msg && <p className="text-danger text-sm">{msg}</p>}

      {!items ? (
        <p className="text-ink-400">Loading…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardTitle>No digital deliveries yet</CardTitle>
          <CardDescription>
            When you buy a digital product, its license key or download appears here.
          </CardDescription>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((d) => {
            const remaining = d.downloadLimit - d.downloadCount;
            const expired = new Date(d.expiresAt).getTime() < Date.now();
            return (
              <Card key={d.id}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link href={`/p/${d.productSlug}`} className="text-lg font-medium hover:text-accent-200">
                        {d.productTitle}
                      </Link>
                      <Badge tone="accent">{d.type === 'LICENSE_KEY' ? 'License key' : 'Download'}</Badge>
                      {expired && <Badge tone="danger">Expired</Badge>}
                    </div>
                    <div className="text-sm text-ink-400 mt-1">
                      Delivered {new Date(d.deliveredAt).toLocaleString()} ·
                      {' '}Expires {new Date(d.expiresAt).toLocaleDateString()}
                      {d.type === 'FILE_DOWNLOAD' && (
                        <> · {remaining} of {d.downloadLimit} downloads left</>
                      )}
                    </div>
                    {d.notesToBuyer && (
                      <p className="text-ink-300 text-sm mt-2">{d.notesToBuyer}</p>
                    )}
                    {revealedKey[d.id] && (
                      <pre className="mt-3 font-mono text-sm bg-ink-900 border border-ink-700 rounded-md p-3 select-all">
                        {revealedKey[d.id]}
                      </pre>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {d.type === 'LICENSE_KEY' && d.hasLicenseKey && !revealedKey[d.id] && (
                      <Button size="sm" loading={busyId === d.id} onClick={() => reveal(d.id)}>
                        Reveal key
                      </Button>
                    )}
                    {d.type === 'LICENSE_KEY' && !d.hasLicenseKey && (
                      <Badge tone="warning">Pending seller</Badge>
                    )}
                    {d.type === 'FILE_DOWNLOAD' && (
                      <Button
                        size="sm"
                        loading={busyId === d.id}
                        disabled={expired || remaining <= 0}
                        onClick={() => download(d.id)}
                      >
                        Download
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

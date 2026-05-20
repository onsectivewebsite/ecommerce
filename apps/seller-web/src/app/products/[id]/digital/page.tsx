'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Badge, Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import type { DigitalGoodType, DigitalProductDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function DigitalProductPage() {
  const params = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [dp, setDp] = React.useState<DigitalProductDto | null>(null);
  const [type, setType] = React.useState<DigitalGoodType>('LICENSE_KEY');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [keysText, setKeysText] = React.useState('');
  const [downloadLimit, setDownloadLimit] = React.useState(5);
  const [expiryDays, setExpiryDays] = React.useState(30);
  const [notes, setNotes] = React.useState('');

  const reload = React.useCallback(() => {
    if (!user) return;
    api.digital.getForProduct(params.id).then((d) => {
      setDp(d);
      if (d) {
        setType(d.type);
        setDownloadLimit(d.downloadLimit);
        setExpiryDays(d.expiryDays);
        setNotes(d.notesToBuyer ?? '');
      }
    }).catch(() => setDp(null));
  }, [user, params.id]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function saveConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get('file') as File | null;
    let fileBase64: string | undefined;
    let fileName: string | undefined;
    if (type === 'FILE_DOWNLOAD' && file && file.size > 0) {
      const buf = new Uint8Array(await file.arrayBuffer());
      fileBase64 = bufferToBase64(buf);
      fileName = file.name;
    }
    try {
      await api.digital.upsert(params.id, {
        type, downloadLimit, expiryDays, notesToBuyer: notes || null, fileBase64, fileName,
      });
      setMsg('Saved.');
      reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed');
    } finally { setBusy(false); }
  }

  async function importKeys() {
    const lines = keysText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) { setMsg('Paste at least one key.'); return; }
    setBusy(true); setMsg(null);
    try {
      const result = await api.digital.importKeys(params.id, { keys: lines });
      setMsg(`Imported ${result.inserted}, skipped ${result.skippedDuplicates} duplicate(s). Pool now ${result.totalAvailable} available.`);
      setKeysText('');
      reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Import failed');
    } finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Digital delivery</h1>
        <p className="text-ink-400 text-sm mt-1">
          Configure how this product delivers after purchase. License keys are encrypted at rest;
          file downloads are served via signed, short-lived URLs.
        </p>
      </header>

      {msg && <p className="text-success text-sm">{msg}</p>}

      <Card>
        <CardTitle>Configuration</CardTitle>
        <CardDescription>Pick a delivery type and (for downloads) the asset.</CardDescription>
        <form onSubmit={saveConfig} className="mt-4 grid grid-cols-12 gap-3 items-end">
          <div className="col-span-4">
            <label className="text-sm font-medium text-ink-200">Type</label>
            <select
              className="ons-input mt-1.5"
              value={type}
              onChange={(e) => setType(e.target.value as DigitalGoodType)}
            >
              <option value="LICENSE_KEY" className="bg-ink-900">License key</option>
              <option value="FILE_DOWNLOAD" className="bg-ink-900">File download</option>
            </select>
          </div>
          <Input
            className="col-span-3"
            label="Download limit"
            type="number"
            min={1}
            value={downloadLimit}
            onChange={(e) => setDownloadLimit(Math.max(1, Number(e.target.value || 1)))}
          />
          <Input
            className="col-span-3"
            label="Expiry days"
            type="number"
            min={1}
            value={expiryDays}
            onChange={(e) => setExpiryDays(Math.max(1, Number(e.target.value || 1)))}
          />
          {type === 'FILE_DOWNLOAD' && (
            <div className="col-span-12">
              <label className="text-sm font-medium text-ink-200">
                File {dp?.fileSizeBytes ? `(current: ${(dp.fileSizeBytes / 1024 / 1024).toFixed(2)} MB — leave blank to keep)` : ''}
              </label>
              <input name="file" type="file" className="ons-input mt-1.5" />
            </div>
          )}
          <div className="col-span-12">
            <label className="text-sm font-medium text-ink-200">Notes to buyer</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="ons-input mt-1.5 min-h-[80px]"
              placeholder="Activation instructions, regional notes, etc."
            />
          </div>
          <div className="col-span-12"><Button type="submit" loading={busy}>Save configuration</Button></div>
        </form>
      </Card>

      {type === 'LICENSE_KEY' && (
        <Card>
          <CardTitle>License-key pool</CardTitle>
          <CardDescription>
            Paste one key per line. Duplicates are de-duped silently. Keys are AES-256-GCM encrypted at rest;
            we never log or expose plaintext keys outside the buyer's delivery view.
          </CardDescription>
          {dp?.poolStats && (
            <div className="mt-2 flex gap-2">
              <Badge tone="success">{dp.poolStats.available} available</Badge>
              <Badge tone="accent">{dp.poolStats.assigned} assigned</Badge>
              <Badge tone="neutral">{dp.poolStats.revoked} revoked</Badge>
            </div>
          )}
          <textarea
            value={keysText}
            onChange={(e) => setKeysText(e.target.value)}
            className="ons-input mt-3 font-mono min-h-[160px]"
            placeholder={'XXXX-YYYY-ZZZZ-AAAA\nXXXX-YYYY-ZZZZ-BBBB'}
          />
          <div className="mt-3"><Button onClick={importKeys} loading={busy}>Import keys</Button></div>
        </Card>
      )}
    </div>
  );
}

function bufferToBase64(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

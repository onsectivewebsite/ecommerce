'use client';

import * as React from 'react';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import type { AdminSettingDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const [settings, setSettings] = React.useState<AdminSettingDto[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    if (!user) return;
    api.admin.listSettings().then(setSettings);
  }, [user]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function save(key: string, value: string) {
    setBusy(key);
    setMsg(null);
    try {
      await api.admin.updateSetting({ key, value });
      setMsg(`Saved ${key}`);
      reload();
    } finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!settings) return <div className="container py-16 text-ink-400">Loading settings…</div>;

  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Platform settings</h1>
      <Card>
        <CardTitle>Global keys</CardTitle>
        <CardDescription>Each key is consumed by checkout, commission, and presentation.</CardDescription>
        {msg && <p className="text-success text-sm mt-3">{msg}</p>}
        <div className="mt-5 space-y-4">
          {settings.map((s) => (
            <form
              key={s.key}
              onSubmit={(e) => { e.preventDefault(); save(s.key, String(new FormData(e.currentTarget).get('value'))); }}
              className="grid grid-cols-[1fr_2fr_auto] gap-3 items-end"
            >
              <div className="text-xs text-ink-300">
                <div className="font-mono">{s.key}</div>
                {s.description && <div className="text-ink-500 mt-1">{s.description}</div>}
              </div>
              <Input name="value" defaultValue={s.value} />
              <Button type="submit" size="sm" loading={busy === s.key}>Save</Button>
            </form>
          ))}
        </div>
      </Card>
    </div>
  );
}

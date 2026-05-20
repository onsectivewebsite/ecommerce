'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type {
  AiInferenceRunRow,
  AiModelKind,
  AiModelRow,
  CounterfeitWatchEntryRow,
} from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminAiVisionPage() {
  const { user, loading } = useAuth();
  const [models, setModels] = React.useState<AiModelRow[] | null>(null);
  const [runs, setRuns] = React.useState<AiInferenceRunRow[]>([]);
  const [watchlist, setWatchlist] = React.useState<CounterfeitWatchEntryRow[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [name, setName] = React.useState('');
  const [version, setVersion] = React.useState('1.0');
  const [kind, setKind] = React.useState<AiModelKind>('AUTH');
  const [providerKind, setProviderKind] = React.useState<string>('heuristic');
  const [threshold, setThreshold] = React.useState<number>(0.7);

  const load = React.useCallback(async () => {
    const [m, r, w] = await Promise.all([
      api.aiVision.models().catch(() => []),
      api.aiVision.runs(50).catch(() => []),
      api.aiVision.watchlist().catch(() => []),
    ]);
    setModels(m); setRuns(r); setWatchlist(w);
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function register() {
    setBusy('register'); setErr(null);
    try {
      await api.aiVision.registerModel({
        name, kind, version, providerKind, thresholdConfidence: threshold,
      });
      setName('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function toggleActive(m: AiModelRow) {
    setBusy(m.id);
    try { await api.aiVision.setModelActive(m.id, !m.isActive); load(); }
    finally { setBusy(null); }
  }

  async function clearSerial(serial: string) {
    if (!confirm(`Clear watch entry for ${serial}?`)) return;
    setBusy(serial);
    try { await api.aiVision.clearWatch(serial); load(); }
    finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!models) return <div className="container py-16 text-ink-400">Loading AI vision…</div>;

  return (
    <div className="container py-10 space-y-10">
      <header>
        <h1 className="font-display text-3xl tracking-tight">AI vision</h1>
        <p className="text-sm text-ink-400 mt-1">
          Register vision models for authentication, grading, and counterfeit detection.
          The active model per kind drives the suggestion shown to warehouse staff. Humans
          still own every decision.
        </p>
      </header>

      <section>
        <h2 className="font-medium mb-3">Register a model</h2>
        <div className="ons-card space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Model name" className="ons-input" />
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version" className="ons-input" />
            <select value={kind} onChange={(e) => setKind(e.target.value as AiModelKind)} className="ons-input">
              <option value="AUTH">AUTH</option>
              <option value="GRADE">GRADE</option>
              <option value="COUNTERFEIT">COUNTERFEIT</option>
            </select>
            <select value={providerKind} onChange={(e) => setProviderKind(e.target.value)} className="ons-input">
              <option value="heuristic">heuristic</option>
              <option value="remote">remote</option>
            </select>
            <input type="number" min={0} max={1} step={0.05} value={threshold}
                   onChange={(e) => setThreshold(Number(e.target.value))}
                   placeholder="Threshold confidence" className="ons-input" />
          </div>
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={busy === 'register' || !name} onClick={register} className="ons-btn-primary">
            {busy === 'register' ? 'Registering…' : 'Register model'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-3">Models</h2>
        {models.length === 0 ? <p className="text-ink-400">No models registered.</p> : (
          <div className="space-y-2">
            {models.map((m) => (
              <div key={m.id} className="ons-card flex items-center gap-3">
                <Badge tone={m.isActive ? 'success' : 'neutral'}>{m.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>
                <Badge tone="neutral">{m.kind}</Badge>
                <div className="flex-1">
                  <p className="text-sm font-medium">{m.name} <code className="text-xs text-ink-400">v{m.version}</code></p>
                  <p className="text-xs text-ink-400 mt-1">
                    provider={m.providerKind} · threshold {(m.thresholdConfidence * 100).toFixed(0)}%
                  </p>
                </div>
                <button disabled={busy === m.id} onClick={() => toggleActive(m)} className="ons-btn-ghost text-xs">
                  {m.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-3">Counterfeit watchlist</h2>
        {watchlist.length === 0 ? <p className="text-ink-400">No serials on the watchlist.</p> : (
          <div className="space-y-1">
            {watchlist.map((w) => (
              <div key={w.id} className="ons-card flex items-center gap-3 text-sm">
                <Badge tone="danger">{w.signalCount}</Badge>
                <code className="flex-1">{w.serialNumber}</code>
                {w.lastReason && <span className="text-xs text-ink-400 truncate max-w-xs">{w.lastReason}</span>}
                <button disabled={busy === w.serialNumber} onClick={() => clearSerial(w.serialNumber)} className="ons-btn-ghost text-xs">Clear</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-3">Recent inferences</h2>
        <div className="space-y-1">
          {runs.map((r) => (
            <div key={r.id} className="ons-card flex items-center gap-3 text-xs">
              <Badge tone="neutral">{r.kind}</Badge>
              <code className="text-ink-400">{r.providerKind}</code>
              <code className="text-ink-400">{r.model?.name ?? '—'}</code>
              <span className="flex-1 text-ink-300">{r.inputRefKind}/{r.inputRefId.slice(-8)}</span>
              <span className="text-ink-500">{r.latencyMs}ms</span>
              <span className="text-ink-500">{new Date(r.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

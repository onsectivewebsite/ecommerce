'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { AiSignal } from '@onsective/api-client';

interface Props {
  loading: boolean;
  error: string | null;
  suggestion: string | null;
  confidence: number | null;
  signals: AiSignal[];
  runId: string | null;
  kind: 'AUTH' | 'GRADE' | 'COUNTERFEIT';
}

/**
 * Renders the AI suggestion for either auth-check or grading.
 * Decision still lives with the human — this is informational only.
 */
export function AiSuggestionPanel({ loading, error, suggestion, confidence, signals, runId, kind }: Props) {
  if (loading) return <div className="text-xs text-ink-400">AI suggestion loading…</div>;
  if (error) return <div className="text-xs text-danger">AI suggestion unavailable: {error}</div>;
  if (!suggestion && signals.length === 0) return null;

  const tone =
    suggestion === 'PASS' || suggestion === 'GRADE_A' ? 'success' as const
    : suggestion === 'FAIL' || suggestion === 'REJECT' ? 'danger' as const
    : 'warning' as const;

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-gold-400">AI assist · {kind.toLowerCase()}</span>
        {suggestion && <Badge tone={tone}>Suggests {suggestion}</Badge>}
        {confidence != null && (
          <span className="text-xs text-ink-400">{(confidence * 100).toFixed(0)}% confidence</span>
        )}
      </div>
      {signals.length > 0 && (
        <ul className="text-xs space-y-1">
          {signals.map((s, idx) => (
            <li key={idx} className={[
              'flex items-center gap-2',
              s.severity === 'BLOCK' ? 'text-danger' : s.severity === 'WARN' ? 'text-warning' : 'text-ink-300',
            ].join(' ')}>
              <span className="font-mono">{s.severity}</span>
              <span className="font-medium">{s.name}</span>
              <span>· {s.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-ink-500">
        Informational only. The human decision is what gets recorded.
        {runId && <span className="ml-1">Run {runId.slice(-8)}.</span>}
      </p>
    </div>
  );
}

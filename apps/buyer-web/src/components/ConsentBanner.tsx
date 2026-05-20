'use client';

import * as React from 'react';
import type {
  ConsentCategories,
  ConsentRegion,
  ConsentRecordRow,
} from '@onsective/api-client';
import { api } from '@/lib/api';

interface BannerState {
  show: boolean;
  region: ConsentRegion;
  policyVersion: string;
  expanded: boolean;
  busy: boolean;
}

const initialBanner: BannerState = {
  show: false,
  region: 'REST',
  policyVersion: '',
  expanded: false,
  busy: false,
};

/**
 * Phase 32 cookie banner. Renders once when no consent record exists for the
 * current identity (anonymous via anonId cookie, or logged-in via /privacy/consent).
 * Three primary actions: Accept all, Reject non-essential, Customize.
 *
 * EU/UK visitors get an extra "we won't track until you choose" notice; non-EU
 * visitors can dismiss with the same buttons. We do not auto-accept anywhere —
 * a visible choice is always required.
 */
export function ConsentBanner() {
  const [state, setState] = React.useState<BannerState>(initialBanner);
  const [custom, setCustom] = React.useState<ConsentCategories>({
    functional: false,
    analytics: false,
    marketing: false,
    marketingEmail: false,
    marketingSms: false,
    marketingPush: false,
  });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.privacy.getConsent();
        if (cancelled) return;
        if (res.record) {
          // Already chose — never show again unless the policy version bumps.
          if (res.record.policyVersion === res.policyVersion) {
            setState((s) => ({ ...s, show: false }));
            return;
          }
        }
        setState({
          show: true,
          region: res.detectedRegion,
          policyVersion: res.policyVersion,
          expanded: false,
          busy: false,
        });
      } catch {
        // If the consent endpoint fails (offline, server hiccup) we don't
        // block the page — show nothing rather than guessing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function send(body: ConsentCategories & { preset?: string }) {
    setState((s) => ({ ...s, busy: true }));
    try {
      await api.privacy.captureConsent(body);
      setState((s) => ({ ...s, show: false }));
    } catch {
      setState((s) => ({ ...s, busy: false }));
    }
  }

  async function acceptAll() {
    await send({
      preset: 'accept-all',
      functional: true,
      analytics: true,
      marketing: true,
      marketingEmail: true,
      marketingSms: false, // SMS is opt-in only — accept-all doesn't enable it
      marketingPush: true,
    });
  }

  async function rejectAll() {
    await send({
      preset: 'reject-all',
      functional: false,
      analytics: false,
      marketing: false,
      marketingEmail: false,
      marketingSms: false,
      marketingPush: false,
    });
  }

  async function saveCustom() {
    await send({ preset: 'custom', ...custom });
  }

  if (!state.show) return null;

  const isEuLike = state.region === 'EU' || state.region === 'UK';

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed bottom-4 right-4 z-40 max-w-md rounded-2xl border border-ink-800 bg-ink-950/95 backdrop-blur-md shadow-2xl p-5 text-sm"
    >
      <div className="font-display text-base font-semibold mb-1">
        Your privacy choices
      </div>
      <p className="text-ink-400">
        We use essential cookies to make the site work.{' '}
        {isEuLike
          ? 'With your permission, we also use analytics and marketing cookies.'
          : 'Optional analytics and marketing cookies help us improve the experience.'}{' '}
        Read our{' '}
        <a href="/legal/cookies" className="underline">
          cookie policy
        </a>
        .
      </p>

      {state.expanded && (
        <div className="mt-4 space-y-2">
          <ToggleRow
            label="Essential"
            description="Required for sign-in, cart, checkout."
            checked
            disabled
          />
          <ToggleRow
            label="Functional"
            description="Remember language, locale, and similar preferences."
            checked={!!custom.functional}
            onChange={(v) => setCustom((c) => ({ ...c, functional: v }))}
          />
          <ToggleRow
            label="Analytics"
            description="Product analytics and A/B tests. No advertising."
            checked={!!custom.analytics}
            onChange={(v) => setCustom((c) => ({ ...c, analytics: v }))}
          />
          <ToggleRow
            label="Marketing"
            description="Marketing emails, SMS, push, and on-site promotions."
            checked={!!custom.marketing}
            onChange={(v) =>
              setCustom((c) => ({
                ...c,
                marketing: v,
                marketingEmail: v ? c.marketingEmail ?? true : false,
                marketingPush: v ? c.marketingPush ?? true : false,
                marketingSms: false, // SMS still opt-in via /account/preferences
              }))
            }
          />
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2 justify-end">
        {!state.expanded && (
          <button
            type="button"
            className="ons-btn-ghost"
            onClick={() => setState((s) => ({ ...s, expanded: true }))}
          >
            Customize
          </button>
        )}
        {state.expanded ? (
          <button
            type="button"
            className="ons-btn-primary"
            disabled={state.busy}
            onClick={saveCustom}
          >
            Save choices
          </button>
        ) : (
          <>
            <button
              type="button"
              className="ons-btn-ghost"
              disabled={state.busy}
              onClick={rejectAll}
            >
              Reject non-essential
            </button>
            <button
              type="button"
              className="ons-btn-primary"
              disabled={state.busy}
              onClick={acceptAll}
            >
              Accept all
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ToggleRow(props: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange?.(e.currentTarget.checked)}
      />
      <span>
        <span className="font-medium text-ink-100">{props.label}</span>
        <span className="block text-xs text-ink-400">{props.description}</span>
      </span>
    </label>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ProveRecord = ConsentRecordRow;

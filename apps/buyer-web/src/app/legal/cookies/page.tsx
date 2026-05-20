import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Cookie Policy — Onsective',
  description:
    'How Onsective uses cookies and similar technologies. Read about essential, functional, analytics, and marketing categories and how to manage them.',
};

export default function CookiePolicyPage() {
  return (
    <article className="container py-16 max-w-3xl prose prose-invert">
      <h1 className="font-display text-4xl tracking-tight mb-2">Cookie Policy</h1>
      <p className="text-ink-400 text-sm mb-10">
        Effective date: 2026-05-19. We may update this policy from time to time;
        material changes will trigger a re-prompt in the cookie banner.
      </p>

      <h2 className="text-2xl mt-8">What we use</h2>
      <p>
        Onsective uses cookies, local storage, and similar browser technologies to make
        the site work and, with your permission, to improve it. We group cookies into
        four categories. Only the first is always on; the rest depend on your choices.
      </p>

      <h3 className="mt-6 text-xl">1. Essential</h3>
      <p>
        Needed for the site to function — sign-in, cart, checkout, fraud prevention,
        and remembering your cookie choices themselves. These can't be switched off.
      </p>

      <h3 className="mt-6 text-xl">2. Functional</h3>
      <p>
        Optional cookies that remember preferences like language, locale, and
        recently-viewed products. Disabling these makes the site work but resets
        those preferences on each visit.
      </p>

      <h3 className="mt-6 text-xl">3. Analytics</h3>
      <p>
        Anonymous product analytics — page views, click-through rates, A/B tests.
        We use this to understand what's working and what isn't. No advertising.
      </p>

      <h3 className="mt-6 text-xl">4. Marketing</h3>
      <p>
        Cookies and identifiers used to send marketing emails, marketing push
        notifications, marketing SMS (opt-in only), and to personalize on-site
        promotions. Transactional emails (orders, shipping, security, billing)
        are unaffected by this choice.
      </p>

      <h2 className="text-2xl mt-10">How to manage your choices</h2>
      <ul>
        <li>
          The cookie banner appears the first time you visit. Pick "Accept all",
          "Reject non-essential", or "Customize".
        </li>
        <li>
          You can change your mind at any time from{' '}
          <Link href="/account/preferences" className="underline">/account/preferences</Link>{' '}
          when signed in.
        </li>
        <li>
          Every marketing email includes a one-click unsubscribe link.
        </li>
        <li>
          You can request a copy of your data or delete your account at{' '}
          <Link href="/account/privacy" className="underline">/account/privacy</Link>.
        </li>
      </ul>

      <h2 className="text-2xl mt-10">Region defaults</h2>
      <p>
        EU and UK visitors see opt-in defaults: nothing optional is enabled until
        you choose. Visitors elsewhere see opt-out defaults but still get the
        banner. We never auto-accept anywhere.
      </p>

      <h2 className="text-2xl mt-10">Contact</h2>
      <p>
        Questions about this policy can be sent to{' '}
        <a href="mailto:privacy@onsective.com">privacy@onsective.com</a>.
      </p>
    </article>
  );
}

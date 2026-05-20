import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { CartProvider } from '@/lib/cart-context';
import { I18nProvider } from '@/lib/i18n-context';
import { TopBar } from '@/components/TopBar';
import { ConsentBanner } from '@/components/ConsentBanner';

export const metadata: Metadata = {
  title: 'Onsective — A new kind of marketplace',
  description:
    'Premium goods from independent sellers worldwide. Designed for trust, built for scale.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        <AuthProvider>
          <I18nProvider>
            <CartProvider>
              <TopBar />
              <main>{children}</main>
              <ConsentBanner />
              <footer className="border-t border-ink-800 mt-16">
                <div className="container py-10 text-sm text-ink-400 flex flex-wrap items-center justify-between gap-3">
                  <span>© {new Date().getFullYear()} Onsective — A new kind of marketplace.</span>
                  <span className="text-ink-500">Crafted for trust at scale.</span>
                </div>
              </footer>
            </CartProvider>
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

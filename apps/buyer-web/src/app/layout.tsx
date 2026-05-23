import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { CartProvider } from '@/lib/cart-context';
import { I18nProvider } from '@/lib/i18n-context';
import { TopBar } from '@/components/TopBar';
import { AnnouncementBar } from '@/components/AnnouncementBar';
import { ConsentBanner } from '@/components/ConsentBanner';

export const metadata: Metadata = {
  title: 'Onsective — Shop anything online',
  description:
    'Millions of products from sellers around the world. Electronics, fashion, beauty, home, and more.',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        <AuthProvider>
          <I18nProvider>
            <CartProvider>
              <AnnouncementBar />
              <TopBar />
              <main>{children}</main>
              <ConsentBanner />
              <footer className="border-t border-ink-800 mt-16">
                <div className="container py-10 text-sm text-ink-400 flex flex-wrap items-center justify-between gap-3">
                  <span>© {new Date().getFullYear()} Onsective. All rights reserved.</span>
                  <div className="flex items-center gap-4 text-ink-500">
                    <a href="/legal/cookies" className="hover:text-ink-300">Cookies</a>
                    <a href="/account/privacy" className="hover:text-ink-300">Privacy</a>
                    <a href="/verify" className="hover:text-ink-300">Verify serial</a>
                    <a href="/impact" className="hover:text-ink-300">Impact</a>
                  </div>
                </div>
              </footer>
            </CartProvider>
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

import * as React from 'react';
import { cn } from '../cn';

export interface PortalShellProps {
  brand: string;
  brandHref?: string;
  nav?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function PortalShell({ brand, brandHref = '/', nav, right, children, footer }: PortalShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/80 backdrop-blur-md">
        <div className="container flex h-16 items-center gap-6">
          <a href={brandHref} className="text-lg font-display font-semibold tracking-tight text-ink-50 hover:text-white">
            {brand}
          </a>
          <nav className="flex-1 flex items-center gap-1 text-sm">{nav}</nav>
          <div className="flex items-center gap-2">{right}</div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-ink-800 mt-12">
        <div className="container py-8 text-sm text-ink-400">
          {footer ?? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span>© {new Date().getFullYear()} Onsective. All rights reserved.</span>
              <span className="text-ink-500">Crafted for trust at scale.</span>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

export interface NavLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  active?: boolean;
}

export function NavLink({ active, className, ...rest }: NavLinkProps) {
  return (
    <a
      className={cn(
        'rounded-lg px-3 py-2 text-ink-300 hover:text-ink-50 hover:bg-ink-800/60 transition-colors',
        active && 'text-ink-50 bg-ink-800',
        className,
      )}
      {...rest}
    />
  );
}

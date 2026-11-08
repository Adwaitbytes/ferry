'use client';

import { cn } from '@ferry/ui';
import {
  HandCoins,
  Library,
  LifeBuoy,
  MessagesSquare,
  MonitorSmartphone,
  ScrollText,
  Settings2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ThemeChoice } from '@/lib/theme';
import { useExtension } from './extension-context';
import { Wordmark } from './ferry-mark';
import { ThemeToggle } from './theme-toggle';

const nav: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/rescue', label: 'Rescue', icon: LifeBuoy },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/desk', label: 'Desk', icon: MessagesSquare },
  { href: '/devices', label: 'Devices', icon: MonitorSmartphone },
  { href: '/share', label: 'Share and Earn', icon: HandCoins },
  { href: '/proofs', label: 'Proofs', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

function ExtensionLine() {
  const { state } = useExtension();
  let label: string;
  let tone: 'ok' | 'warn' | 'muted';
  if (state.kind === 'checking') {
    label = 'Looking for the extension';
    tone = 'muted';
  } else if (state.kind === 'not_installed') {
    label = 'Extension not found';
    tone = 'warn';
  } else if (state.kind === 'error') {
    label = 'Extension did not answer';
    tone = 'warn';
  } else if (state.status.locked) {
    label = 'Extension locked';
    tone = 'warn';
  } else if (!state.status.paired) {
    label = 'Browser not paired';
    tone = 'warn';
  } else {
    label = 'Paired with Walrus Memory';
    tone = 'ok';
  }
  return (
    <Link
      href="/start"
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-small text-text-secondary hover:bg-surface-3 hover:text-text-primary"
    >
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', tone === 'ok' ? 'bg-success' : tone === 'warn' ? 'bg-warning' : 'bg-text-disabled')}
      />
      {label}
    </Link>
  );
}

function NavLinks({ orientation }: { orientation: 'rail' | 'bar' }) {
  const pathname = usePathname();
  return (
    <ul className={cn(orientation === 'rail' ? 'flex flex-col gap-0.5' : 'flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none]')}>
      {nav.map(({ href, label, icon: Icon }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href} className="shrink-0">
            <Link
              href={href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center gap-3 rounded-sm px-2.5 text-body font-medium transition-colors duration-150 ease-out',
                current ? 'bg-surface-3 text-text-primary' : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary',
              )}
            >
              <Icon size={orientation === 'rail' ? 18 : 16} strokeWidth={1.75} aria-hidden="true" className={current ? 'text-accent' : undefined} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Left rail at 1024px and up, a top bar with a scrolling nav below that (DESIGN 4.2). */
export function AppShell({ children, theme }: { children: ReactNode; theme: ThemeChoice }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-sm focus:bg-surface-2 focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border-hairline bg-surface-1 px-3 pb-4 pt-5 lg:flex">
        <Link href="/" className="mb-6 rounded-sm px-2.5 py-1" aria-label="Ferry home">
          <Wordmark />
        </Link>
        <nav aria-label="Ferry" className="flex-1">
          <NavLinks orientation="rail" />
        </nav>
        <div className="flex flex-col gap-3 border-t border-border-hairline pt-3">
          <Link
            href="/start"
            className="flex h-9 items-center gap-3 rounded-sm px-2.5 text-body font-medium text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          >
            <Wallet size={18} strokeWidth={1.75} aria-hidden="true" />
            Wallet and pairing
          </Link>
          <ExtensionLine />
          <ThemeToggle initial={theme} className="ml-2 w-fit self-start" />
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-border-hairline bg-surface-1 lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/" aria-label="Ferry home" className="rounded-sm">
            <Wordmark />
          </Link>
          <ThemeToggle initial={theme} />
        </div>
        <nav aria-label="Ferry">
          <NavLinks orientation="bar" />
        </nav>
      </header>

      <main id="main" className="min-w-0 px-4 pb-24 pt-8 md:px-8 lg:pt-12">
        <div className="mx-auto w-full max-w-[1040px]">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex max-w-[68ch] flex-col gap-2">
        <h1 className="ferry-display-md text-display-md text-text-primary">{title}</h1>
        {children ? <div className="text-body-lg text-text-secondary">{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

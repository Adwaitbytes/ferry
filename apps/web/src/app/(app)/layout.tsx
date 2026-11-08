import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { Providers } from '@/components/providers';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

/** Wallet, extension and toast providers live here, so the landing page ships none of them. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <Providers>
      <AppShell theme={theme}>{children}</AppShell>
    </Providers>
  );
}

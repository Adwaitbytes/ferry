import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import './globals.css';

const ZOD_JITLESS = 'globalThis.__zod_globalConfig=Object.assign(globalThis.__zod_globalConfig||{},{jitless:true});';

export const metadata: Metadata = {
  title: { default: 'Ferry: your AI memory, finally yours', template: '%s | Ferry' },
  description: 'One memory you own, across ChatGPT, Claude and Gemini. Stored on Walrus, owned by your Sui wallet.',
  applicationName: 'Ferry',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8F6F1' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1422' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the request makes every page dynamic, which the per-request CSP nonce requires.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // The theme choice is a cookie, so the server paints the right theme with no inline script.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" {...(theme === 'system' ? {} : { 'data-theme': theme })}>
      <head>
        {/* Before any bundle runs: the CSP forbids eval, so zod must skip its `new Function` probe. */}
        <script nonce={nonce}>{ZOD_JITLESS}</script>
      </head>
      <body className="bg-bg font-sans text-body text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}

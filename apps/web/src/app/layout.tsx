import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ferry',
  description: 'One memory you own, across ChatGPT, Claude and Gemini. Stored on Walrus, owned by your Sui wallet.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the request makes every page dynamic, which the per-request CSP nonce requires.
  await headers();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

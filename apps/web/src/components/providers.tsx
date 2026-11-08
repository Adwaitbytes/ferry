'use client';

import { ToastProvider } from '@ferry/ui';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import type { ReactNode } from 'react';
import { dAppKit } from '@/lib/dapp-kit';
import { ExtensionProvider } from './extension-context';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <ExtensionProvider>
        <ToastProvider>{children}</ToastProvider>
      </ExtensionProvider>
    </DAppKitProvider>
  );
}

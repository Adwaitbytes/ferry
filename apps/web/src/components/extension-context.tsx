'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BridgeError, bridge, type ExtensionStatus } from '@/lib/bridge';

export type ExtensionState =
  | { kind: 'checking' }
  | { kind: 'not_installed' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; status: ExtensionStatus };

interface ExtensionApi {
  state: ExtensionState;
  refresh: () => Promise<void>;
}

const ExtensionContext = createContext<ExtensionApi | null>(null);

export function useExtension(): ExtensionApi {
  const api = useContext(ExtensionContext);
  if (!api) throw new Error('useExtension must be used inside <ExtensionProvider>');
  return api;
}

/** One status read shared by the shell and every screen, refreshed on focus. */
export function ExtensionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ExtensionState>({ kind: 'checking' });

  const refresh = useCallback(async () => {
    try {
      const status = await bridge({ type: 'status.get' }, { timeoutMs: 4000 });
      setState({ kind: 'ready', status });
    } catch (error) {
      if (error instanceof BridgeError && (error.kind === 'not_installed' || error.kind === 'timeout')) setState({ kind: 'not_installed' });
      else setState({ kind: 'error', message: error instanceof Error ? error.message : 'Ferry did not answer.' });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const api = useMemo(() => ({ state, refresh }), [state, refresh]);
  return <ExtensionContext.Provider value={api}>{children}</ExtensionContext.Provider>;
}

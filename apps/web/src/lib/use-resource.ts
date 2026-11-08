'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type Resource<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'error'; data: null; error: Error }
  | { status: 'ready'; data: T; error: null };

/**
 * Loads one async value with explicit loading, error and ready states. Stale responses from an
 * earlier key are dropped, so a slow request can never overwrite a newer one.
 */
export function useResource<T>(load: (() => Promise<T>) | null, key: string): Resource<T> & { reload: () => void } {
  const [state, setState] = useState<Resource<T>>({ status: 'loading', data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const run = loadRef.current;
    if (!run) return;
    let active = true;
    setState({ status: 'loading', data: null, error: null });
    run().then(
      (data) => {
        if (active) setState({ status: 'ready', data, error: null });
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', data: null, error: error instanceof Error ? error : new Error('Request failed.') });
      },
    );
    return () => {
      active = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/** True once `delayMs` has passed while `active` stays true. Used to avoid skeleton flashes. */
export function useDelayed(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return elapsed;
}

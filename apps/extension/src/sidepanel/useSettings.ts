import { useToast } from '@ferry/ui';
import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../worker/settings';
import { call } from './client';

/** Settings with immediate per-control save and a "Saved" toast (DESIGN 8.9). */
export function useSettings() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call<Settings>({ type: 'settings.get' }).then((res) => {
      if (res.ok) setSettings(res.data);
      else setError(res.message);
    });
  }, []);

  const update = useCallback(
    async (patch: Record<string, unknown>) => {
      const res = await call<Settings>({ type: 'settings.set', patch });
      if (res.ok) {
        setSettings(res.data);
        toast.show({ message: 'Saved', tone: 'success' });
      } else {
        toast.show({ message: `Could not save this setting: ${res.message}`, tone: 'error' });
      }
    },
    [toast],
  );

  return { settings, error, update };
}

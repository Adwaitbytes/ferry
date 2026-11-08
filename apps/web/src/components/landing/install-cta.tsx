'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Detects the extension with one `status.get` ping and swaps the CTA (DESIGN 8.1). Deliberately
 * free of zod and the bridge so the landing page ships almost no JavaScript; any reply means the
 * extension is installed, and the app validates everything properly after the click.
 */
export function InstallCta({ extensionId, releaseUrl }: { extensionId: string | null; releaseUrl: string }) {
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const chromeGlobal: unknown = Reflect.get(globalThis, 'chrome');
    const runtime: unknown = chromeGlobal && typeof chromeGlobal === 'object' ? Reflect.get(chromeGlobal, 'runtime') : null;
    if (!extensionId || !runtime || typeof runtime !== 'object') return;
    const send: unknown = Reflect.get(runtime, 'sendMessage');
    if (typeof send !== 'function') return;
    try {
      send.call(runtime, extensionId, { type: 'status.get' }, (reply: unknown) => {
        // Touching lastError marks it handled when no extension listens on this id.
        const failed = Boolean(Reflect.get(runtime, 'lastError'));
        if (!failed && reply) setInstalled(true);
      });
    } catch {
      setInstalled(false);
    }
  }, [extensionId]);

  const primary =
    'inline-flex h-11 items-center rounded-sm bg-accent px-[18px] text-body-lg font-medium text-accent-fg transition-colors duration-150 ease-out hover:bg-accent-hover active:bg-accent-press';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {installed ? (
          <Link href="/start" className={primary}>
            Open Ferry
          </Link>
        ) : (
          <a href={releaseUrl} className={primary}>
            Add Ferry to Chrome
          </a>
        )}
        <Link href="/proofs" className="text-body-lg font-medium text-accent underline-offset-[3px] hover:underline">
          See the proofs
        </Link>
      </div>
      <p className="text-small text-text-tertiary" aria-live="polite">
        {installed ? 'Ferry is installed. Pair this browser to start.' : 'Free and open source. Chrome 116 or later.'}
      </p>
    </div>
  );
}

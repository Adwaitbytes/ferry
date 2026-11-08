import type { PanelRequest, WorkerResult } from '@ferry/core';
import { browser } from 'wxt/browser';

/** Every side panel request goes through the worker; the panel never touches keys or the relayer. */
export async function call<T>(message: PanelRequest): Promise<WorkerResult<T>> {
  try {
    return (await browser.runtime.sendMessage(message)) as WorkerResult<T>;
  } catch {
    return {
      ok: false,
      code: 'internal',
      message: 'Ferry could not reach its background worker. Reopen the side panel.',
    };
  }
}

/** Opens the vault with the passphrase (core message type `unlock`; the UI says "Open Ferry"). */
export function openFerry<T>(passphrase: string): Promise<WorkerResult<T>> {
  return call<T>({ type: 'unlock', passphrase });
}

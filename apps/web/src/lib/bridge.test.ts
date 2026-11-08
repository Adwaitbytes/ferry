import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
type Bridge = typeof import('./bridge');
let mod: Bridge;

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_FERRY_EXTENSION_ID', EXTENSION_ID);
  mod = await import('./bridge');
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'chrome');
});

function installRuntime(reply: unknown, lastError?: { message: string }) {
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn((_id: string, _msg: unknown, cb: (r: unknown) => void) => {
      runtime.lastError = lastError;
      cb(reply);
      runtime.lastError = undefined;
    }),
  };
  Reflect.set(globalThis, 'chrome', { runtime });
  return runtime;
}

describe('bridge', () => {
  it('reports not_installed when chrome.runtime is missing', async () => {
    await expect(mod.bridge({ type: 'status.get' })).rejects.toMatchObject({ kind: 'not_installed' });
  });

  it('reports not_installed when no extension listens on the id', async () => {
    installRuntime(undefined, { message: 'Could not establish connection.' });
    await expect(mod.bridge({ type: 'status.get' })).rejects.toMatchObject({ kind: 'not_installed' });
  });

  it('sends to the configured extension id and validates the data', async () => {
    const runtime = installRuntime({ ok: true, data: { locked: false, paired: true, accountId: null } });
    await expect(mod.bridge({ type: 'status.get' })).resolves.toMatchObject({ paired: true, locked: false });
    expect(runtime.sendMessage).toHaveBeenCalledWith(EXTENSION_ID, { type: 'status.get' }, expect.any(Function));
  });

  it('maps worker errors to typed errors with retry hints', async () => {
    installRuntime({ ok: false, code: 'cooling_down', message: 'Cooling down.', retryAfterMs: 40_000 });
    const error = await mod.bridge({ type: 'import.progress' }).catch((e: unknown) => e);
    expect(mod.isBridgeError(error, 'cooling_down')).toBe(true);
    expect((error as InstanceType<Bridge['BridgeError']>).retryAfterMs).toBe(40_000);
  });

  it.each([
    ['locked', 'locked'],
    ['not_paired', 'not_paired'],
    ['forbidden_sender', 'forbidden'],
  ] as const)('maps %s to %s', async (code, kind) => {
    installRuntime({ ok: false, code, message: 'x' });
    await expect(mod.bridge({ type: 'status.get' })).rejects.toMatchObject({ kind });
  });

  it('rejects a response that does not match the schema', async () => {
    installRuntime({ ok: true, data: { written: 'many' } });
    await expect(mod.bridge({ type: 'import.progress' })).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('rejects a reply that is not an envelope', async () => {
    installRuntime('<html>');
    await expect(mod.bridge({ type: 'status.get' })).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});

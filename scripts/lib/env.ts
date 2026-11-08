/** Shared by the tsx scripts: read required env by name, never echo a value. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. Add it to .env.local.`);
  return value;
}

const ACCOUNT_ID = /^0x[0-9a-f]{64}$/;

export function requireAccountId(name: string): string {
  const value = requireEnv(name).toLowerCase();
  if (!ACCOUNT_ID.test(value)) throw new Error(`${name} must be 0x followed by 64 hex characters.`);
  return value;
}

/** A MemWal delegate private key: 32 bytes as 64 hex characters, as `generateDelegateKey` prints it. */
export function requireDelegateSeed(name: string): Uint8Array {
  const hex = requireEnv(name).toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`${name} must be a 32-byte hex delegate key.`);
  return Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

export const relayerUrl = (): string => process.env['MEMWAL_RELAYER_URL']?.trim() || 'https://relayer.memory.walrus.xyz';

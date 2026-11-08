/**
 * One-off setup for the Ferry Gate "Public profile" account (PRD F8).
 *
 * Generates a fresh owner keypair and a Gate delegate seed, creates the MemWalAccount and adds
 * the delegate key using the Walrus Memory relayer's sponsored gas (no SUI needed), then writes
 * the results into the repo's gitignored .env.local. Secrets are never printed.
 *
 * Usage: pnpm --filter @ferry/memwal exec tsx scripts/setup-public-account.ts
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSponsorAuthorization } from '@mysten-incubation/memwal';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import type { Transaction } from '@mysten/sui/transactions';
import { buildAddDelegateKeyTx, buildCreateAccountTx } from '@ferry/chain/tx';
import { generateSeed, publicKeyHex } from '../src/seed.js';

const RELAYER = process.env.MEMWAL_RELAYER_URL ?? 'https://relayer.memory.walrus.xyz';
const ENV_PATH = resolve(import.meta.dirname, '../../../.env.local');
// Building a transaction kind only resolves shared object versions; this one-off setup runs
// before a Tatum key exists, so it reads through the public fullnode.
const sui = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });

function setEnv(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  return new RegExp(`^${key}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${text.trimEnd()}\n${line}\n`;
}

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${RELAYER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} failed with ${res.status}: ${String(json.code ?? '')} ${String(json.error ?? '')}`);
  return json;
}

async function sponsorAndExecute(owner: Ed25519Keypair, tx: Transaction): Promise<string> {
  const sender = owner.toSuiAddress();
  const kindBytes = await tx.build({ client: sui, onlyTransactionKind: true });
  const auth = await createSponsorAuthorization(sender, kindBytes, async (message) => ({
    signature: (await owner.signPersonalMessage(message)).signature,
  }));
  const sponsored = await postJson('/sponsor', { sender, transactionBlockKindBytes: toBase64(kindBytes), ...auth });
  const bytes = String(sponsored.bytes ?? '');
  const digest = String(sponsored.digest ?? '');
  if (!bytes || !digest) throw new Error('/sponsor returned no transaction bytes');
  const { signature } = await owner.signTransaction(fromBase64(bytes));
  await postJson('/sponsor/execute', { digest, signature, sender });
  await sui.waitForTransaction({ digest });
  return digest;
}

async function accountOf(owner: string): Promise<{ accountId: string | null; keys: { public_key: string }[] }> {
  const res = await fetch(`${RELAYER}/api/accounts/${owner}/delegate-keys`);
  const json = (await res.json()) as { account_id: string | null; keys: { public_key: string }[] };
  return { accountId: json.account_id, keys: json.keys };
}

async function main(): Promise<void> {
  if (!existsSync(ENV_PATH)) throw new Error('.env.local not found at repo root');
  let env = readFileSync(ENV_PATH, 'utf8');
  if (/^GATE_PUBLIC_ACCOUNT_ID=0x[0-9a-f]+$/m.test(env)) throw new Error('GATE_PUBLIC_ACCOUNT_ID already set; refusing to create a second account');

  const owner = new Ed25519Keypair();
  const ownerAddress = owner.toSuiAddress();
  env = setEnv(env, 'GATE_PUBLIC_ACCOUNT_OWNER', ownerAddress);
  env = setEnv(env, 'GATE_PUBLIC_OWNER_PRIVATE_KEY', owner.getSecretKey());
  writeFileSync(ENV_PATH, env, { mode: 0o600 });
  console.log(`owner address ${ownerAddress}`);

  const createDigest = await sponsorAndExecute(owner, buildCreateAccountTx());
  console.log(`create_account tx ${createDigest}`);

  let accountId: string | null = null;
  for (let i = 0; i < 10 && !accountId; i++) {
    accountId = (await accountOf(ownerAddress)).accountId;
    if (!accountId) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!accountId) throw new Error('account not visible on the relayer yet; rerun the delegate step later');
  console.log(`account ${accountId}`);

  const seed = generateSeed();
  const pubHex = await publicKeyHex(seed);
  const addDigest = await sponsorAndExecute(
    owner,
    buildAddDelegateKeyTx({ accountId, publicKey32: Uint8Array.from(Buffer.from(pubHex, 'hex')), label: 'Ferry Gate' }),
  );
  console.log(`add_delegate_key tx ${addDigest}`);
  console.log(`gate delegate public key ${pubHex}`);

  env = readFileSync(ENV_PATH, 'utf8');
  env = setEnv(env, 'GATE_PUBLIC_ACCOUNT_ID', accountId);
  env = setEnv(env, 'GATE_DELEGATE_PRIVATE_KEY', Buffer.from(seed).toString('hex'));
  if (!/^GATE_MPP_SECRET_KEY=.{32,}$/m.test(env)) env = setEnv(env, 'GATE_MPP_SECRET_KEY', randomBytes(32).toString('base64'));
  writeFileSync(ENV_PATH, env, { mode: 0o600 });
  seed.fill(0);
  console.log('wrote GATE_* values to .env.local');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'setup failed');
  process.exit(1);
});

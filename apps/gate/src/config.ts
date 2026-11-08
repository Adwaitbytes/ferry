import { PUBLIC_NAMESPACE, tryNormalizeAddress } from '@ferry/pay';
import { z } from 'zod';

const Address = z.string().refine((value) => tryNormalizeAddress(value) !== null, 'must be a Sui address');
const ObjectId = z.string().regex(/^0x[0-9a-f]{1,64}$/, 'must be a lowercase 0x object id');

const GateEnv = z.object({
  DATABASE_URL: z.string().startsWith('postgres'),
  GATE_MPP_SECRET_KEY: z.string().min(32),
  GATE_REALM: z.string().min(1).max(100).default('ferry-gate'),
  GATE_PUBLIC_ACCOUNT_ID: ObjectId,
  GATE_PUBLIC_ACCOUNT_OWNER: Address,
  GATE_DELEGATE_PRIVATE_KEY: z.string().min(32),
  GATE_PRIVATE_ACCOUNT_IDS: z.string().default(''),
  MEMWAL_RELAYER_URL: z.url({ protocol: /^https$/ }).default('https://relayer.memory.walrus.xyz'),
  SESSION_SECRET: z.string().min(32),
  NEXT_PUBLIC_FERRY_WEB_ORIGIN: z.url(),
  SUI_FULLNODE_URL: z.url({ protocol: /^https$/ }).default('https://fullnode.mainnet.sui.io:443'),
});
export type GateConfig = z.infer<typeof GateEnv>;

/**
 * Parses the environment and runs the X-GATE-1 startup assertion: the Gate's account must not
 * be any private account. Variable names only in errors, never values.
 */
export function loadGateConfig(env: Readonly<Record<string, string | undefined>>): GateConfig {
  const parsed = GateEnv.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].join(', ');
    throw new Error(`Gate configuration invalid: ${names}`);
  }
  const privateIds = parsed.data.GATE_PRIVATE_ACCOUNT_IDS.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean);
  if (privateIds.includes(parsed.data.GATE_PUBLIC_ACCOUNT_ID)) {
    throw new Error('GATE_PUBLIC_ACCOUNT_ID is a private account. The Gate may only hold the Public profile account.');
  }
  if (PUBLIC_NAMESPACE !== 'ferry-public') throw new Error('Gate namespace must be ferry-public');
  return parsed.data;
}

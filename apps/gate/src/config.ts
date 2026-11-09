import { PUBLIC_NAMESPACE, SUI_NETWORKS, tryNormalizeAddress, type SuiNetwork } from '@ferry/pay';
import { z } from 'zod';

const Address = z.string().refine((value) => tryNormalizeAddress(value) !== null, 'must be a Sui address');
const ObjectId = z.string().regex(/^0x[0-9a-f]{1,64}$/, 'must be a lowercase 0x object id');

/** Public fullnodes for the x402 path, which executes the payer-signed bytes. */
export const SUI_FULLNODES: Readonly<Record<SuiNetwork, string>> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
};

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
  /** Payment network only. Recall always reads the Mainnet Public profile account. */
  GATE_SUI_NETWORK: z.enum(SUI_NETWORKS).default('mainnet'),
  SUI_FULLNODE_URL: z.url({ protocol: /^https$/ }).optional(),
  /** Read by packages/chain; listed here only so a cross-network value is caught at startup. */
  TATUM_SUI_GRPC_URL: z.string().optional(),
});
export type GateConfig = Omit<z.infer<typeof GateEnv>, 'SUI_FULLNODE_URL'> & { SUI_FULLNODE_URL: string };

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
  // A project cloned from the Mainnet Gate carries Mainnet node URLs; paying on one network and
  // verifying on another would refuse every honest payment, so fail loudly instead.
  const otherNetwork = parsed.data.GATE_SUI_NETWORK === 'mainnet' ? 'testnet' : 'mainnet';
  for (const name of ['SUI_FULLNODE_URL', 'TATUM_SUI_GRPC_URL'] as const) {
    if (parsed.data[name]?.toLowerCase().includes(otherNetwork)) throw new Error(`${name} points at ${otherNetwork} but GATE_SUI_NETWORK is ${parsed.data.GATE_SUI_NETWORK}`);
  }
  return { ...parsed.data, SUI_FULLNODE_URL: parsed.data.SUI_FULLNODE_URL ?? SUI_FULLNODES[parsed.data.GATE_SUI_NETWORK] };
}

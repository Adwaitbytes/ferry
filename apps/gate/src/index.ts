import { getChainService } from '@ferry/chain';
import { GateGuard, GatePayments, PayStore, neonSqlClient } from '@ferry/pay';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { createApp } from './app.js';
import { loadGateConfig } from './config.js';
import { createGateLogger } from './log.js';
import { memwalPublicRecall } from './recall.js';
import { tatumVerifier } from './verifier.js';

// Vercel zero-config entry (src/index.ts, default export of a Hono app), Node runtime.
const config = loadGateConfig(process.env);
const store = new PayStore(neonSqlClient(config.DATABASE_URL));
const chain = getChainService(process.env);

const app = createApp({
  store,
  guard: new GateGuard(store),
  payments: new GatePayments({
    store,
    verifier: tatumVerifier(chain),
    secretKey: config.GATE_MPP_SECRET_KEY,
    realm: config.GATE_REALM,
    network: 'mainnet',
    // x402 needs a node that executes the payer-signed bytes; Tatum then re-verifies the result.
    x402Client: new SuiGrpcClient({ network: 'mainnet', baseUrl: config.SUI_FULLNODE_URL }),
  }),
  recall: memwalPublicRecall({
    delegateKey: config.GATE_DELEGATE_PRIVATE_KEY,
    accountId: config.GATE_PUBLIC_ACCOUNT_ID,
    relayerUrl: config.MEMWAL_RELAYER_URL,
  }),
  log: createGateLogger((line) => process.stdout.write(`${line}\n`)),
  publicAccountId: config.GATE_PUBLIC_ACCOUNT_ID,
  publicAccountOwner: config.GATE_PUBLIC_ACCOUNT_OWNER,
  webOrigin: config.NEXT_PUBLIC_FERRY_WEB_ORIGIN,
  sessionSecret: config.SESSION_SECRET,
  usdcUsdPrice: () => chain.getUsdPrice('USDC'),
});

export default app;

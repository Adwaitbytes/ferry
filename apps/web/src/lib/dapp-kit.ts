import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SUI_FULLNODE_URL } from './env';

/**
 * Wallet connection only. The browser cannot speak native gRPC to Tatum (RESEARCH 2.1), so the
 * wallet client talks gRPC-Web to the public fullnode, and every proof the UI shows is read through
 * the Tatum proxy instead. No JSON-RPC anywhere: it is gone from public fullnodes.
 */
export const dAppKit = createDAppKit({
  networks: ['mainnet'],
  defaultNetwork: 'mainnet',
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: SUI_FULLNODE_URL }),
  slushWalletConfig: { appName: 'Ferry' },
});

declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}

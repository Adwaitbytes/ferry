/*
 * CI-only mock Sui wallet (PRD 9: "wallet mocked only in CI"). Registered through the Wallet
 * Standard so dApp Kit discovers it exactly like Slush. Transactions are never submitted: it answers
 * with an offline-built transaction and success effects prepared by the test runner, and records
 * what the dApp asked it to sign so specs can assert the Move call. Personal messages (SIWS) are
 * signed with the CI-only key so the local Gate verifies them. The real Mainnet run is manual.
 */
import {
  registerWallet,
  type IdentifierArray,
  type StandardConnectFeature,
  type StandardEventsFeature,
  type SuiSignAndExecuteTransactionFeature,
  type SuiSignPersonalMessageFeature,
  type SuiSignTransactionFeature,
  type Wallet,
  type WalletAccount,
} from '@mysten/wallet-standard';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { STORAGE, type E2EConfig, type WalletLogEntry } from '../protocol';

declare global {
  interface Window {
    __FERRY_E2E_CONFIG__: E2EConfig;
  }
}

const fixture = window.__FERRY_E2E_CONFIG__.wallet;

function record(entry: WalletLogEntry): void {
  const prior = JSON.parse(localStorage.getItem(STORAGE.walletLog) ?? '[]') as WalletLogEntry[];
  localStorage.setItem(STORAGE.walletLog, JSON.stringify([...prior, entry]));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function readTransaction(transaction: { toJSON(): Promise<string> }): Promise<string | null> {
  try {
    return await transaction.toJSON();
  } catch {
    return null;
  }
}

if (fixture !== null) {
  const chains: IdentifierArray = ['sui:mainnet'];
  const account: WalletAccount = {
    address: fixture.address,
    publicKey: fromBase64(fixture.publicKey).slice(1),
    chains,
    features: ['sui:signTransaction', 'sui:signAndExecuteTransaction', 'sui:signPersonalMessage'],
  };

  const features: StandardConnectFeature & StandardEventsFeature & SuiSignTransactionFeature & SuiSignAndExecuteTransactionFeature & SuiSignPersonalMessageFeature = {
    'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
    'standard:events': { version: '1.0.0', on: () => () => undefined },
    'sui:signTransaction': {
      version: '2.0.0',
      signTransaction: async ({ transaction }) => {
        record({ feature: 'sui:signTransaction', transaction: await readTransaction(transaction) });
        return { bytes: fixture.success.bytes, signature: fixture.success.signature };
      },
    },
    'sui:signAndExecuteTransaction': {
      version: '2.0.0',
      signAndExecuteTransaction: async ({ transaction }) => {
        record({ feature: 'sui:signAndExecuteTransaction', transaction: await readTransaction(transaction) });
        return fixture.success;
      },
    },
    'sui:signPersonalMessage': {
      version: '1.1.0',
      signPersonalMessage: async ({ message }) => {
        record({ feature: 'sui:signPersonalMessage', transaction: null });
        return Ed25519Keypair.fromSecretKey(fromBase64(fixture.secretKey)).signPersonalMessage(message);
      },
    },
  };

  const wallet: Wallet = {
    version: '1.0.0',
    name: 'Ferry CI Mock Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iNCIgZmlsbD0iIzBmNzY2ZSIvPjwvc3ZnPg==',
    chains,
    features,
    accounts: [account],
  };
  registerWallet(wallet);
}

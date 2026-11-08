import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';

/** What the CI-only mock wallet answers to `sui:signAndExecuteTransaction`. */
export interface MockExecution {
  bytes: string;
  signature: string;
  digest: string;
  effects: string;
}

export interface MockWalletFixture {
  address: string;
  publicKey: string;
  /**
   * CI-only key, the same deterministic key the Gate test rig uses as the card owner
   * (apps/gate/test/harness.ts `ownerKey`), so SIWS sign-in and owner-only earnings verify for
   * real against the local Gate. It controls nothing on any network.
   */
  secretKey: string;
  success: MockExecution;
}

/**
 * Builds a structurally valid, signed transaction and matching success effects entirely offline.
 * dApp Kit parses both with the Sui SDK, so the mock wallet must return real BCS, not placeholders.
 * Nothing here is ever submitted to a network.
 */
export async function buildMockWalletFixture(): Promise<MockWalletFixture> {
  const secret = new Uint8Array(32).fill(3);
  const keypair = Ed25519Keypair.fromSecretKey(secret);
  const address = keypair.toSuiAddress();

  const tx = new Transaction();
  tx.setSender(address);
  tx.setGasPrice(1000);
  tx.setGasBudget(10_000_000);
  tx.setGasPayment([{ objectId: `0x${'ab'.repeat(32)}`, version: '1', digest: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi' }]);
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1)]);
  tx.transferObjects([coin], tx.pure.address(address));
  const transactionBytes = await tx.build();
  const digest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  const { signature } = await keypair.signTransaction(transactionBytes);

  const effects = bcs.TransactionEffects.serialize({
    V2: {
      status: { Success: true },
      executedEpoch: '900',
      gasUsed: { computationCost: '1000', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
      transactionDigest: digest,
      gasObjectIndex: null,
      eventsDigest: null,
      dependencies: [],
      lamportVersion: '1',
      changedObjects: [],
      unchangedConsensusObjects: [],
      auxDataDigest: null,
    },
  }).toBytes();

  return {
    address,
    publicKey: toBase64(keypair.getPublicKey().toSuiBytes()),
    secretKey: toBase64(secret),
    success: { bytes: toBase64(transactionBytes), signature, digest, effects: toBase64(effects) },
  };
}

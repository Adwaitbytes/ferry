import { SealClient, SessionKey } from '@mysten/seal';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import { walrus } from '@mysten/walrus';
import {
  BACKUP_EPOCHS,
  MAX_RELAY_TIP_MIST,
  MEMWAL_PACKAGE_ID,
  MEMWAL_REGISTRY_ID,
  SEAL_KEY_SERVERS,
  SEAL_THRESHOLD,
  WALRUS_UPLOAD_RELAY,
  backupSealId,
  packBackup,
  unpackBackup,
  type BackupRecord,
} from './backup';

/*
 * F9 wallet and network steps. Loaded with a dynamic import from the Settings page only, so Seal
 * and the Walrus encoder (WASM) never weigh on other routes. Nothing here spends funds by itself:
 * every transaction goes to the user's wallet for approval.
 */

export interface WalletPort {
  address: string;
  /** Resolves to the digest, or throws when the wallet declines or Sui rejects the transaction. */
  signAndExecute(transaction: Transaction): Promise<string>;
  signPersonalMessage(message: Uint8Array): Promise<string>;
}

export type BackupStep = 'encrypting' | 'encoding' | 'registering' | 'uploading' | 'certifying';

export class BackupError extends Error {
  override readonly name = 'BackupError';
}

function sealClient(suiClient: SuiGrpcClient): SealClient {
  return new SealClient({
    suiClient,
    serverConfigs: SEAL_KEY_SERVERS.map((s) => ({ objectId: s.objectId, weight: 1 })),
    verifyKeyServers: true,
  });
}

export async function createBackup(input: {
  suiClient: SuiGrpcClient;
  wallet: WalletPort;
  accountId: string;
  /** `access_counter_version`, read fresh from chain right before encrypting (RESEARCH 6). */
  accessCounterVersion: bigint;
  file: { name: string; bytes: Uint8Array };
  onStep(step: BackupStep): void;
}): Promise<BackupRecord> {
  const { suiClient, wallet, file, onStep } = input;
  const createdAt = new Date().toISOString();
  const sealId = backupSealId(wallet.address, input.accessCounterVersion);

  onStep('encrypting');
  const { encryptedObject } = await sealClient(suiClient).encrypt({
    threshold: SEAL_THRESHOLD,
    packageId: MEMWAL_PACKAGE_ID,
    id: sealId,
    data: packBackup({ name: file.name, createdAt }, file.bytes),
  });

  const client = suiClient.$extend(
    walrus({ uploadRelay: { host: WALRUS_UPLOAD_RELAY, sendTip: { max: MAX_RELAY_TIP_MIST } } }),
  );
  const flow = client.walrus.writeBlobFlow({ blob: encryptedObject });
  onStep('encoding');
  await flow.encode();
  onStep('registering');
  const registerDigest = await wallet.signAndExecute(
    flow.register({ epochs: BACKUP_EPOCHS, deletable: true, owner: wallet.address }),
  );
  onStep('uploading');
  await flow.upload({ digest: registerDigest });
  onStep('certifying');
  await wallet.signAndExecute(flow.certify());
  const certified = await flow.getBlob();

  return {
    blobId: certified.blobId,
    blobObjectId: certified.blobObjectId,
    owner: wallet.address,
    accountId: input.accountId,
    sealId,
    fileName: file.name,
    size: file.bytes.length,
    encryptedSize: encryptedObject.length,
    endEpoch: Number(certified.blobObject.storage.end_epoch),
    createdAt,
  };
}

/**
 * Restore: read the ciphertext from the aggregator, then ask the key servers for shares with a
 * dry run of `seal_approve`. The session key is signed once by the wallet, which must be the
 * account owner (a delegate key would also pass the policy, but only the extension holds one).
 */
export async function restoreBackup(input: {
  suiClient: SuiGrpcClient;
  wallet: WalletPort;
  record: BackupRecord;
  aggregatorUrl: string;
}): Promise<{ name: string; bytes: Uint8Array }> {
  const { suiClient, wallet, record } = input;
  const response = await fetch(`${input.aggregatorUrl}/v1/blobs/${encodeURIComponent(record.blobId)}`);
  if (!response.ok) throw new BackupError(`The Walrus aggregator returned ${response.status} for this blob.`);
  const ciphertext = new Uint8Array(await response.arrayBuffer());

  const sessionKey = await SessionKey.create({ address: wallet.address, packageId: MEMWAL_PACKAGE_ID, ttlMin: 10, suiClient });
  await sessionKey.setPersonalMessageSignature(await wallet.signPersonalMessage(sessionKey.getPersonalMessage()));

  const tx = new Transaction();
  tx.moveCall({
    target: `${MEMWAL_PACKAGE_ID}::account::seal_approve`,
    arguments: [tx.pure.vector('u8', Array.from(fromHex(record.sealId))), tx.object(MEMWAL_REGISTRY_ID), tx.object(record.accountId)],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  const plain = await sealClient(suiClient).decrypt({ data: ciphertext, sessionKey, txBytes });
  const { header, bytes } = unpackBackup(plain);
  return { name: header.name, bytes };
}

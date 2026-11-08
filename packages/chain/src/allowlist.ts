import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { MEMWAL_PACKAGE_ID } from './constants.js';
import type { TatumSui } from './rpc.js';

/**
 * X-CHP-1: the only Move calls Ferry will relay through its Tatum key. MemWal account management
 * (pairing, unpairing, account creation) and the Sui framework calls an x402 or MPP payment uses.
 */
const ALLOWED_CALLS = new Set([
  `${MEMWAL_PACKAGE_ID}::account::create_account`,
  `${MEMWAL_PACKAGE_ID}::account::add_delegate_key`,
  `${MEMWAL_PACKAGE_ID}::account::remove_delegate_key`,
  `${normalizeSuiAddress('0x2')}::coin::send_funds`,
  `${normalizeSuiAddress('0x2')}::coin::redeem_funds`,
  `${normalizeSuiAddress('0x2')}::balance::send_funds`,
  `${normalizeSuiAddress('0x2')}::coin::into_balance`,
  `${normalizeSuiAddress('0x2')}::coin::from_balance`,
]);

/** Plain PTB commands with no package code behind them. */
const ALLOWED_COMMANDS = new Set(['MoveCall', 'SplitCoins', 'MergeCoins', 'TransferObjects']);

export type AllowlistResult = { ok: true; calls: string[] } | { ok: false; reason: 'MALFORMED' | 'COMMAND_NOT_ALLOWED' | 'CALL_NOT_ALLOWED'; detail: string };

/** Static check over the signed bytes; runs before any upstream call. */
export function checkTransactionAllowlist(transactionBytes: Uint8Array): AllowlistResult {
  let commands: ReturnType<Transaction['getData']>['commands'];
  try {
    commands = Transaction.from(transactionBytes).getData().commands;
  } catch {
    return { ok: false, reason: 'MALFORMED', detail: 'not a transaction' };
  }
  if (commands.length === 0) return { ok: false, reason: 'MALFORMED', detail: 'no commands' };
  const calls: string[] = [];
  for (const command of commands) {
    if (!ALLOWED_COMMANDS.has(command.$kind)) return { ok: false, reason: 'COMMAND_NOT_ALLOWED', detail: command.$kind };
    if (command.MoveCall) {
      const target = `${normalizeSuiAddress(command.MoveCall.package)}::${command.MoveCall.module}::${command.MoveCall.function}`;
      if (!ALLOWED_CALLS.has(target)) return { ok: false, reason: 'CALL_NOT_ALLOWED', detail: target };
      calls.push(target);
    }
  }
  return { ok: true, calls };
}

export type RelayResult =
  | { ok: true; digest: string }
  | { ok: false; reason: 'MALFORMED' | 'COMMAND_NOT_ALLOWED' | 'CALL_NOT_ALLOWED' | 'SIMULATION_FAILED' | 'EXECUTION_FAILED' };

/** Allowlist, then simulate, then execute: the proxy never pays credits to land a doomed or foreign transaction. */
export async function relaySignedTransaction(sui: TatumSui, transactionBytes: Uint8Array, signatures: string[]): Promise<RelayResult> {
  const allowed = checkTransactionAllowlist(transactionBytes);
  if (!allowed.ok) return { ok: false, reason: allowed.reason };
  const simulated = await sui.simulateTransaction(transactionBytes);
  if (simulated.$kind !== 'Transaction') return { ok: false, reason: 'SIMULATION_FAILED' };
  const executed = await sui.executeTransaction(transactionBytes, signatures);
  if (executed.$kind !== 'Transaction') return { ok: false, reason: 'EXECUTION_FAILED' };
  return { ok: true, digest: executed.Transaction.digest };
}

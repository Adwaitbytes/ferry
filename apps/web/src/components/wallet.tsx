'use client';

import { Button, MonoId } from '@ferry/ui';
import { useCurrentAccount, useDAppKit, useWalletConnection, useWallets } from '@mysten/dapp-kit-react';
import { Wallet } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { explorer } from '@/lib/links';

const subscribeNothing = () => () => undefined;

/**
 * False on the server and during hydration, true after. Wallet extensions register before React
 * hydrates, so rendering the live list on the first client pass would not match the server HTML,
 * and under Trusted Types React cannot recover from that mismatch: the page goes blank.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}

/** Slush first, then every other wallet the browser announces (DESIGN 8.2 step 1). */
export function WalletPicker({ onConnected }: { onConnected?: (address: string) => void }) {
  const hydrated = useHydrated();
  const wallets = useWallets();
  const dAppKit = useDAppKit();
  const connection = useWalletConnection();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = [...wallets].sort((a, b) => Number(/slush/i.test(b.name)) - Number(/slush/i.test(a.name)));

  const connect = async (index: number) => {
    const wallet = sorted[index];
    if (!wallet) return;
    setPending(wallet.name);
    setError(null);
    try {
      const { accounts } = await dAppKit.connectWallet({ wallet });
      const address = accounts[0]?.address;
      if (address) onConnected?.(address);
    } catch {
      setError('Wallet connection was declined. Connect again when you are ready.');
    } finally {
      setPending(null);
    }
  };

  if (!hydrated) return <p className="text-small text-text-secondary">Looking for Sui wallets in this browser</p>;
  if (connection.isReconnecting) return <p className="text-small text-text-secondary">Reconnecting your wallet</p>;

  return (
    <div className="flex flex-col gap-3">
      {sorted.length === 0 ? (
        <p className="text-body text-text-secondary">
          No Sui wallet found in this browser. Install{' '}
          <a href="https://slush.app" target="_blank" rel="noreferrer noopener" className="text-accent underline-offset-[3px] hover:underline">
            Slush
          </a>{' '}
          and reload this page.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((wallet, index) => (
            <li key={wallet.name}>
              <Button
                variant={index === 0 ? 'primary' : 'secondary'}
                size={index === 0 ? 'lg' : 'md'}
                icon={Wallet}
                className="w-full justify-start sm:w-auto"
                loading={pending === wallet.name}
                loadingLabel="Waiting for your wallet"
                disabled={pending !== null}
                onClick={() => void connect(index)}
              >
                {`Connect ${wallet.name}`}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ConnectedWallet() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  if (!account) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-small text-text-secondary">
      <span>Wallet</span>
      <MonoId value={account.address} kind="Wallet address" href={explorer.account(account.address)} />
      <Button variant="link" size="sm" className="text-small" onClick={() => void dAppKit.disconnectWallet()}>
        Disconnect
      </Button>
    </div>
  );
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new TypeError('invalid hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

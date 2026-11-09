import type { EmbeddingSetup, VaultStatus } from '@ferry/core';
import { Button, Input, LoadingText, Notice, Toggle, useToast } from '@ferry/ui';
import { KeyRound, RotateCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { call } from './client';

/** DESIGN 9.4, verbatim. */
export const STANDARD_VS_VAULT =
  'Standard mode: the hosted Walrus Memory relayer encrypts and stores your facts, but it sees the text while it processes them. That is convenient, and it is not end to end encryption. Vault mode: your browser creates the search embeddings and encrypts each fact with Seal before anything leaves this device, so the relayer never sees the text. It still sees the vectors, your account owner address, the namespace and when you search. To create embeddings, the text is sent to the embedding provider you choose, with your own key.';

/** DESIGN 9.4: why Vault needs no wallet popup in the extension. */
export const SEAL_SESSION_COPY =
  "Seal hands out decryption keys only to a short session key signed by an address on your account. A wallet cannot sign inside the extension, so Ferry signs that session key with this browser's key, which your wallet approved once when you paired. You approve nothing per session, and removing this browser in Devices withdraws it.";

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', apiBase: 'https://api.openai.com/v1' },
  { value: 'openrouter', label: 'OpenRouter', apiBase: 'https://openrouter.ai/api/v1' },
  { value: 'custom', label: 'Other OpenAI compatible', apiBase: '' },
] as const;
type Provider = (typeof PROVIDERS)[number]['value'];

function providerLabel(apiBase: string): string {
  return (
    PROVIDERS.find((p) => p.apiBase !== '' && p.apiBase === apiBase)?.label ?? new URL(apiBase).host
  );
}

type Load =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; status: VaultStatus };

export function VaultSection({ paired }: { paired: boolean }) {
  const toast = useToast();
  const formId = useId();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [formOpen, setFormOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [customBase, setCustomBase] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await call<VaultStatus>({ type: 'vault.status' });
    setLoad(res.ok ? { kind: 'ready', status: res.data } : { kind: 'error', message: res.message });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async (event: FormEvent) => {
    event.preventDefault();
    const base =
      provider === 'custom'
        ? customBase.trim()
        : PROVIDERS.find((p) => p.value === provider)?.apiBase;
    if (base === undefined || !/^https:\/\/[^\s]+$/.test(base)) {
      setFormError('Enter the provider address, starting with https://');
      return;
    }
    if (apiKey.trim().length < 8) {
      setFormError('Paste the full API key.');
      return;
    }
    setFormError(null);
    setBusy(true);
    const embedding: EmbeddingSetup = { apiKey: apiKey.trim(), apiBase: base };
    const res = await call<VaultStatus>({ type: 'vault.enable', embedding });
    setBusy(false);
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setApiKey('');
    setFormOpen(false);
    setLoad({ kind: 'ready', status: res.data });
    toast.show({
      message: 'Vault mode is on. New facts are encrypted on this device.',
      tone: 'success',
    });
  };

  const disable = async () => {
    setBusy(true);
    const res = await call<VaultStatus>({ type: 'vault.disable' });
    setBusy(false);
    if (!res.ok) {
      toast.show({ message: res.message, tone: 'error' });
      return;
    }
    setLoad({ kind: 'ready', status: res.data });
    toast.show({
      message: 'Standard mode is on. Your embedding key was deleted.',
      tone: 'success',
    });
  };

  if (load.kind === 'loading') return <LoadingText>Reading privacy mode</LoadingText>;
  if (load.kind === 'error') {
    return (
      <Notice
        tone="danger"
        title="Could not read privacy mode"
        live
        action={
          <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => void refresh()}>
            Try again
          </Button>
        }
      >
        {load.message}
      </Notice>
    );
  }

  const { status } = load;
  const on = status.mode === 'vault';

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[56ch] text-small text-text-secondary">{STANDARD_VS_VAULT}</p>

      <div className="flex flex-col gap-3 rounded-md border border-border-hairline bg-surface-1 p-4 shadow-1">
        <Toggle
          label="Vault mode"
          showState
          checked={on || formOpen}
          disabled={!paired || busy}
          {...(!paired ? { disabledReason: 'Pair this browser first.' } : {})}
          description={
            on && status.embedding !== null
              ? `New facts are encrypted here with Seal. Embeddings through ${providerLabel(status.embedding.apiBase)}, ${status.embedding.model}.`
              : 'Facts you already saved stay in Standard mode. Only new facts go to Vault.'
          }
          onCheckedChange={(next) => {
            if (next) setFormOpen(true);
            else if (on) void disable();
            else {
              setFormOpen(false);
              setFormError(null);
            }
          }}
        />

        {formOpen && !on ? (
          <form
            id={formId}
            className="flex flex-col gap-3 border-t border-border-hairline pt-3"
            onSubmit={(e) => void enable(e)}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-body font-medium">Embedding provider</span>
              <select
                className="h-8 rounded-sm border border-border-control bg-surface-2 px-2 text-body text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {provider === 'custom' ? (
              <Input
                label="Provider address"
                inputMode="url"
                placeholder="https://"
                value={customBase}
                onChange={(e) => setCustomBase(e.target.value)}
                helper="Must return 1536 dimension vectors, like text-embedding-3-small."
                autoComplete="off"
                spellCheck={false}
              />
            ) : null}
            <Input
              label="API key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              helper="Stored only in this extension, sealed under your Ferry key. Never sent to Ferry or to chat pages."
              error={formError}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex items-start gap-2 rounded-sm bg-surface-2 p-3">
              <ShieldCheck
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-accent"
              />
              <p className="text-small text-text-secondary">{SEAL_SESSION_COPY}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                icon={KeyRound}
                loading={busy}
                loadingLabel="Checking the key"
              >
                Turn on Vault mode
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setFormOpen(false);
                  setFormError(null);
                  setApiKey('');
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {on ? <p className="text-small text-text-tertiary">{SEAL_SESSION_COPY}</p> : null}
      </div>
    </div>
  );
}

'use client';

import { DeskProvider, type Suggestion } from '@ferry/core';
import { Button, cn, Counter, DemoLabel, EmptyState, IconButton, LoadingText, Notice, SourceBadges, Textarea, VerifyCheck, Waterline } from '@ferry/ui';
import { duration, ease } from '@ferry/ui/motion';
import { motion, useReducedMotion } from 'motion/react';
import { MessagesSquare, Plug, Receipt, SendHorizontal, Unplug } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { PageHeader } from '@/components/app-shell';
import { ExtensionGate } from '@/components/extension-gate';
import { ReceiptView, type ReceiptTarget } from '@/components/receipt';
import { bridge } from '@/lib/bridge';

const PROVIDER_LABEL: Record<DeskProvider, string> = { claude: 'Claude', gpt: 'GPT', gemini: 'Gemini' };
const ORDER: readonly DeskProvider[] = ['claude', 'gpt', 'gemini'];
const RECALL_LIMIT = 8;

interface Turn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: DeskProvider;
  memories?: Suggestion[];
}

type Phase = { kind: 'idle' } | { kind: 'recalling'; count: number | null } | { kind: 'asking'; provider: DeskProvider; count: number } | { kind: 'error'; message: string };

interface CutResult {
  from: DeskProvider;
  to: DeskProvider;
  before: number;
  lost: number;
}

const ProvidersResponse = z.object({ providers: z.array(DeskProvider) });

function useProviders() {
  const [available, setAvailable] = useState<DeskProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/providers', { cache: 'no-store' })
      .then(async (response) => {
        const parsed = ProvidersResponse.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error('bad response');
        setAvailable(parsed.data.providers);
      })
      .catch(() => setError('Could not read which models this deployment serves.'));
  }, []);
  return { available, error };
}

const DESK_ERRORS: Record<string, string> = {
  RATE_LIMITED: 'Too many messages in a short time. Wait a few seconds and send again.',
  BODY_TOO_LARGE: 'This thread is too long for one request. Start a new thread.',
  INVALID_REQUEST: 'Ferry sent a request the Desk service rejected. Reload and try again.',
  NO_PROVIDER: 'No model is available right now. Reconnect a provider or try later.',
};

function ProviderPicker({
  value,
  onChange,
  available,
  cutOff,
}: {
  value: DeskProvider;
  onChange: (p: DeskProvider) => void;
  available: readonly DeskProvider[];
  cutOff: readonly DeskProvider[];
}) {
  return (
    <div role="radiogroup" aria-label="Model" className="inline-flex h-9 rounded-sm border border-border-hairline bg-surface-2 p-0.5">
      {ORDER.map((p) => {
        const off = cutOff.includes(p);
        const missing = !available.includes(p);
        const checked = value === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={off || missing}
            title={off ? `${PROVIDER_LABEL[p]} is cut off (simulated)` : missing ? `${PROVIDER_LABEL[p]} is not configured on this deployment` : undefined}
            onClick={() => onChange(p)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[5px] px-3 text-body font-medium transition-colors duration-150 ease-out disabled:cursor-not-allowed',
              checked ? 'bg-surface-1 text-text-primary shadow-1' : 'text-text-secondary hover:text-text-primary',
              (off || missing) && 'text-text-disabled line-through hover:text-text-disabled',
            )}
          >
            {off ? <Unplug size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
            {PROVIDER_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

async function recallFor(query: string): Promise<Suggestion[]> {
  return bridge({ type: 'memory.recall', query: query.slice(0, 2000), limit: RECALL_LIMIT });
}

function DeskScreen() {
  const reduce = useReducedMotion();
  const { available, error: providersError } = useProviders();
  const [provider, setProvider] = useState<DeskProvider>('claude');
  const [cutOff, setCutOff] = useState<DeskProvider[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [cut, setCut] = useState<CutResult | null>(null);
  const [browning, setBrowning] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptTarget | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (available && !available.includes(provider) && available[0]) setProvider(available[0]);
  }, [available, provider]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' });
  }, [turns, phase, reduce]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const lastMemories = [...turns].reverse().find((t) => t.role === 'assistant' && t.memories)?.memories ?? [];

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || phase.kind === 'recalling' || phase.kind === 'asking') return;
    const userTurn: Turn = { id: crypto.randomUUID(), role: 'user', content };
    const history = [...turns, userTurn];
    setTurns(history);
    setDraft('');
    setPhase({ kind: 'recalling', count: null });

    let memories: Suggestion[];
    try {
      memories = await recallFor(content);
    } catch (e) {
      setPhase({ kind: 'error', message: `Ferry could not recall your memory: ${e instanceof Error ? e.message : 'no answer'}` });
      return;
    }
    setPhase({ kind: 'asking', provider, count: memories.length });

    const controller = new AbortController();
    abortRef.current = controller;
    const assistantId = crypto.randomUUID();
    try {
      const response = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        body: JSON.stringify({
          provider,
          cutOff,
          messages: history
            .filter((t): t is Turn & { role: 'user' | 'assistant' } => t.role !== 'system')
            .slice(-40)
            .map((t) => ({ role: t.role, content: t.content.slice(0, 8000) })),
          context: memories.map((m) => ({ ref: m.ref, text: m.text })),
        }),
      });
      if (!response.ok || !response.body) {
        const code = await response
          .json()
          .then((b: unknown) => (typeof b === 'object' && b !== null && 'error' in b ? String((b as { error: unknown }).error) : ''))
          .catch(() => '');
        throw new Error(DESK_ERRORS[code] ?? `The Desk service returned ${response.status}.`);
      }
      const served = DeskProvider.safeParse(response.headers.get('x-ferry-provider'));
      const servedBy = served.success ? served.data : provider;
      setTurns((t) => [...t, { id: assistantId, role: 'assistant', content: '', provider: servedBy, memories }]);
      setPhase({ kind: 'idle' });
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setTurns((t) => t.map((turn) => (turn.id === assistantId ? { ...turn, content: turn.content + value } : turn)));
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
      setPhase({
        kind: 'error',
        message: timedOut
          ? `${PROVIDER_LABEL[provider]} did not answer: the request timed out after 30s. Try again or switch model.`
          : `${PROVIDER_LABEL[provider]} did not answer: ${e instanceof Error ? e.message : 'unknown error'}`,
      });
    }
  };

  const cutOffNow = async () => {
    const from = provider;
    const nextCut = [...cutOff, from];
    const to = ORDER.find((p) => !nextCut.includes(p) && (available ?? []).includes(p));
    if (!to) return;
    abortRef.current?.abort();
    setBrowning(true);
    setCutOff(nextCut);

    // The drill's claim, measured: re-run every earlier recall now and count facts that no longer come back.
    const queries = turns.filter((t) => t.role === 'user').map((t) => t.content);
    const before = new Set(turns.flatMap((t) => (t.memories ?? []).map((m) => m.ref)));
    let lost = 0;
    try {
      const after = new Set((await Promise.all(queries.map(recallFor))).flat().map((m) => m.ref));
      lost = [...before].filter((ref) => !after.has(ref)).length;
    } catch {
      lost = before.size;
    }

    const wait = reduce ? 0 : 280;
    setTimeout(() => {
      setBrowning(false);
      setProvider(to);
      setTurns((t) => [
        ...t,
        {
          id: crypto.randomUUID(),
          role: 'system',
          content: `This simulates ${PROVIDER_LABEL[from]} cutting you off. Your memory lives on Walrus, not inside ${PROVIDER_LABEL[from]}.`,
        },
      ]);
      setCut({ from, to, before: before.size, lost });
      setPhase({ kind: 'idle' });
    }, wait);
  };

  const reconnect = () => {
    if (!cut) return;
    setCutOff((c) => c.filter((p) => p !== cut.from));
    setProvider(cut.from);
    setCut(null);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  const busy = phase.kind === 'recalling' || phase.kind === 'asking';
  const canCut = available !== null && ORDER.some((p) => p !== provider && !cutOff.includes(p) && available.includes(p)) && !cutOff.includes(provider);

  return (
    <>
      <PageHeader title="Desk">
        A chat that remembers you through Walrus, whatever model answers. Cut one off and the next carries on.
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-label="Conversation" className="flex min-h-[560px] flex-col rounded-md border border-border-hairline bg-surface-1 shadow-1">
          <header className="flex flex-wrap items-center gap-3 border-b border-border-hairline px-4 py-3">
            {available ? (
              <ProviderPicker value={provider} onChange={setProvider} available={available} cutOff={cutOff} />
            ) : providersError ? (
              <span className="text-small text-danger">{providersError}</span>
            ) : (
              <LoadingText>Checking which models are available</LoadingText>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button icon={Unplug} disabled={!canCut || busy} onClick={() => void cutOffNow()}>
                Cut off
              </Button>
              <DemoLabel />
            </div>
          </header>

          <div className={cn('flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5', browning && 'ferry-brownout')} aria-live="polite">
            {turns.length === 0 && !busy ? (
              <EmptyState
                icon={MessagesSquare}
                title="Ask anything"
                action={
                  <div className="flex flex-wrap gap-2">
                    {['Plan dinner for Friday', 'What should I pack for Lisbon'].map((prompt) => (
                      <Button key={prompt} variant="secondary" size="sm" onClick={() => void send(prompt)}>
                        {prompt}
                      </Button>
                    ))}
                  </div>
                }
              >
                Ferry recalls what it knows about you from Walrus and shows which facts it used.
              </EmptyState>
            ) : null}

            {turns.map((turn) =>
              turn.role === 'user' ? (
                <div key={turn.id} className="max-w-[80%] self-end rounded-md bg-surface-3 px-4 py-2.5 text-body text-text-primary">
                  {turn.content}
                </div>
              ) : turn.role === 'system' ? (
                <motion.div
                  key={turn.id}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: duration.base, ease: ease.out }}
                  className="flex flex-col gap-3"
                >
                  <div className="flex items-start gap-2 rounded-md bg-warning-subtle px-4 py-3 text-body text-text-primary">
                    <Unplug size={16} strokeWidth={1.75} className="mt-[3px] shrink-0 text-warning" aria-hidden="true" />
                    <span className="flex-1">{turn.content}</span>
                    <DemoLabel />
                  </div>
                  <motion.div
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: duration.slower, ease: ease.out, delay: reduce ? 0 : 0.2 }}
                    style={{ originX: 0 }}
                  >
                    <Waterline />
                  </motion.div>
                  {cut ? (
                    <p className="text-small font-medium text-accent">{`Continuing on ${PROVIDER_LABEL[cut.to]}`}</p>
                  ) : null}
                </motion.div>
              ) : (
                <article key={turn.id} className="flex flex-col gap-2">
                  <span className="text-small text-text-tertiary">{turn.provider ? PROVIDER_LABEL[turn.provider] : 'Assistant'}</span>
                  <p className="whitespace-pre-wrap text-body text-text-primary">{turn.content || '…'}</p>
                  {turn.memories && turn.memories.length > 0 ? (
                    <p className="flex flex-wrap items-center gap-2 text-small text-text-secondary">
                      {`Used ${turn.memories.length} ${turn.memories.length === 1 ? 'memory' : 'memories'}`}
                      <SourceBadges vendors={turn.memories.flatMap((m) => m.sources)} />
                    </p>
                  ) : (
                    <p className="text-small text-text-tertiary">No memories matched this message.</p>
                  )}
                </article>
              ),
            )}

            {phase.kind === 'recalling' ? <LoadingText>Recalling from your memory on Walrus</LoadingText> : null}
            {phase.kind === 'asking' ? (
              <LoadingText>{`Recalled ${phase.count} ${phase.count === 1 ? 'memory' : 'memories'}, now asking ${PROVIDER_LABEL[phase.provider]}`}</LoadingText>
            ) : null}
            {phase.kind === 'error' ? (
              <Notice tone="danger" live>
                {phase.message}
              </Notice>
            ) : null}
            <div ref={endRef} />
          </div>

          <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-border-hairline p-3">
            <Textarea
              label="Message"
              hideLabel
              fieldClassName="flex-1"
              className="min-h-11 resize-none"
              rows={1}
              placeholder={`Message ${PROVIDER_LABEL[provider]}`}
              value={draft}
              maxLength={8000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
            />
            <IconButton icon={SendHorizontal} label="Send message" type="submit" variant="secondary" disabled={busy || !draft.trim()} />
          </form>
        </section>

        <aside aria-label="Memory used in this reply" className="flex flex-col gap-4">
          {cut ? (
            <div className="flex flex-col gap-2 rounded-md border border-border-hairline bg-surface-1 p-5 shadow-1">
              <div className="flex items-center gap-3">
                <Counter value={cut.lost} className="text-display-lg font-semibold tracking-[-0.03em] text-text-primary" />
                <span className="ferry-display text-display-lg text-text-primary">facts lost</span>
                {cut.lost === 0 ? <VerifyCheck state="verified" size={32} /> : null}
              </div>
              <p className="text-body text-text-secondary">
                {cut.before === 0
                  ? `Ask something about you on ${PROVIDER_LABEL[cut.to]} to see the same memory come back.`
                  : `Same ${cut.before} ${cut.before === 1 ? 'fact' : 'facts'}, now answering on ${PROVIDER_LABEL[cut.to]}. Counted by re-running every earlier recall after the cut.`}
              </p>
              <Button variant="link" icon={Plug} className="self-start" onClick={reconnect}>
                {`Reconnect ${PROVIDER_LABEL[cut.from]}`}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-col gap-3 rounded-md border border-border-hairline bg-surface-1 p-5 shadow-1">
            <h2 className="text-title font-semibold text-text-primary">Memory used in this reply</h2>
            {lastMemories.length === 0 ? (
              <p className="text-body text-text-secondary">Facts Ferry recalls for each reply appear here, each with its receipt.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border-hairline">
                {lastMemories.map((m) => (
                  <li key={m.ref} className="flex items-start gap-2 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <p className="text-body text-text-primary">{m.text}</p>
                      <SourceBadges vendors={m.sources} />
                    </div>
                    <IconButton
                      icon={Receipt}
                      label="Open receipt"
                      size="sm"
                      onClick={() => setReceipt({ quote: m.text, sources: m.sources, receipt: null, blobId: m.ref })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
      <ReceiptView target={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

export function DeskView() {
  return <ExtensionGate title="Desk">{() => <DeskScreen />}</ExtensionGate>;
}

'use client';

import type { CandidateFact, DistilledFact, ImportProgress, Vendor } from '@ferry/core';
import type { ImportProgressEvent, ImportResult } from '@ferry/importers';
import { runImportInWorker } from '@ferry/importers';
import { Button, cn, Notice } from '@ferry/ui';
import { Check, LoaderCircle, RotateCw, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { ExtensionGate } from '@/components/extension-gate';
import { ReceiptView, type ReceiptTarget } from '@/components/receipt';
import { BridgeError, bridge, type ExtensionStatus } from '@/lib/bridge';
import { DistillHttpError, batches, buildCandidates, describeImportError, distillBatch, type ReviewFact } from './pipeline';
import { factsToMove, ReviewStep, type ReviewState } from './review-step';
import { Dropzone, PasteBox, SourcePicker, type SourceSpec } from './source-step';
import { HeroMetric, WritingStep } from './writing-step';

type Stage =
  | { kind: 'pick' }
  | { kind: 'input'; spec: SourceSpec; error: string | null }
  | { kind: 'parsing'; spec: SourceSpec; progress: ImportProgressEvent | null }
  | { kind: 'distilling'; spec: SourceSpec; result: ImportResult; done: number; facts: DistilledFact[]; error: string | null }
  | { kind: 'finishing'; spec: SourceSpec; result: ImportResult }
  | { kind: 'review'; spec: SourceSpec; facts: ReviewFact[] }
  | { kind: 'writing'; spec: SourceSpec; all: ReviewFact[]; moving: ReviewFact[]; error: string | null }
  | { kind: 'done'; spec: SourceSpec; all: ReviewFact[]; moving: ReviewFact[]; written: number };

const PARSE_STEPS = ['Unzipping on this device', 'Finding your messages', 'Distilling facts', 'Checking for sensitive details', 'Removing duplicates'] as const;

function stepIndex(stage: Stage): number {
  if (stage.kind === 'parsing') return stage.progress && (stage.progress.stage === 'parsing' || stage.progress.stage === 'chunking') ? 1 : 0;
  if (stage.kind === 'distilling') return 2;
  if (stage.kind === 'finishing') return 4;
  return -1;
}

function ParseSteps({ stage }: { stage: Stage }) {
  const current = stepIndex(stage);
  const counts: (string | null)[] = [
    stage.kind === 'parsing' && stage.progress ? `${stage.progress.filesParsed.toLocaleString('en-US')} files` : null,
    stage.kind === 'parsing' && stage.progress
      ? `${stage.progress.conversations.toLocaleString('en-US')} conversations`
      : stage.kind === 'distilling'
        ? `${stage.result.stats.userTurns.toLocaleString('en-US')} messages`
        : null,
    stage.kind === 'distilling' ? `${stage.done.toLocaleString('en-US')} of ${stage.result.chunks.length.toLocaleString('en-US')} chunks` : null,
    stage.kind === 'distilling' ? `${stage.facts.filter((f) => f.sensitive.length > 0).length} flagged so far` : null,
    null,
  ];
  return (
    <ol className="flex flex-col gap-3" aria-label="Import steps">
      {PARSE_STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} aria-current={active ? 'step' : undefined} className="flex items-center gap-3">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-micro font-medium tabular',
                done ? 'bg-accent-subtle text-accent' : active ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-text-tertiary',
              )}
            >
              {done ? <Check size={12} strokeWidth={2.25} aria-hidden="true" /> : active ? <LoaderCircle size={12} strokeWidth={2.25} className="ferry-spin" aria-hidden="true" /> : index + 1}
            </span>
            <span className={cn('text-body', active ? 'font-medium text-text-primary' : done ? 'text-text-secondary' : 'text-text-tertiary')}>{label}</span>
            {counts[index] && (active || done) ? <span className="tabular text-small text-text-tertiary">{counts[index]}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function RescueScreen({ status }: { status: ExtensionStatus }) {
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [review, setReviewState] = useState<ReviewState>({ decisions: {}, included: {}, edits: {} });
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptTarget | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      abortRef.current?.abort();
    },
    [],
  );

  const setReview = useCallback((update: (prev: ReviewState) => ReviewState) => setReviewState(update), []);

  const worker = () => {
    workerRef.current ??= new Worker(new URL('../../../workers/import.worker.ts', import.meta.url), { type: 'module' });
    return workerRef.current;
  };

  /* Distill runs batch by batch so it can stop and resume at the exact chunk. */
  const distillFrom = useCallback(async (spec: SourceSpec, result: ImportResult, startBatch: number, prior: DistilledFact[]) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const all = batches(result.chunks);
    const facts = [...prior];
    let done = startBatch * (all[0]?.length ?? 0);
    setStage({ kind: 'distilling', spec, result, done, facts, error: null });
    for (let i = startBatch; i < all.length; i++) {
      const batch = all[i] ?? [];
      try {
        facts.push(...(await distillBatch(batch, controller.signal)));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DistillHttpError && error.retryAfterMs !== null) {
          await new Promise((resolve) => setTimeout(resolve, error.retryAfterMs ?? 10_000));
          i--;
          continue;
        }
        const reason = error instanceof Error ? error.message : 'the Distill service failed';
        setStage({
          kind: 'distilling',
          spec,
          result,
          done,
          facts,
          error: `Distilling stopped at chunk ${done.toLocaleString('en-US')} of ${result.chunks.length.toLocaleString('en-US')}: ${reason}. Your progress in this tab is kept.`,
        });
        return;
      }
      done += batch.length;
      setStage({ kind: 'distilling', spec, result, done, facts: [...facts], error: null });
    }
    setStage({ kind: 'finishing', spec, result });
    const reviewFacts = await buildCandidates(result, facts);
    setReviewState({ decisions: {}, included: {}, edits: {} });
    setStage({ kind: 'review', spec, facts: reviewFacts });
  }, []);

  const runImport = async (spec: SourceSpec, job: Parameters<typeof runImportInWorker>[1]) => {
    setStage({ kind: 'parsing', spec, progress: null });
    const outcome = await runImportInWorker(worker(), job, { onProgress: (p) => setStage({ kind: 'parsing', spec, progress: p }) });
    if (!outcome.ok) {
      setStage({ kind: 'input', spec, error: describeImportError(outcome.error, spec.kind) });
      return;
    }
    if (outcome.value.chunks.length === 0) {
      setStage({ kind: 'review', spec, facts: [] });
      return;
    }
    await distillFrom(spec, outcome.value, 0, []);
  };

  const onFile = async (spec: SourceSpec, file: File) => {
    if (file.name.toLowerCase().endsWith('.zip')) {
      await runImport(spec, { type: 'import.zip', bytes: new Uint8Array(await file.arrayBuffer()) });
    } else {
      await runImport(spec, { type: 'import.files', files: [{ name: file.name, text: await file.text() }] });
    }
  };

  /* Writing: enqueue in the extension, then follow its progress. */
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const follow = useCallback((spec: SourceSpec, all: ReviewFact[], moving: ReviewFact[]) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const p = await bridge({ type: 'import.progress' });
        setProgress(p);
        if (p.state === 'done' && p.written + p.failed >= p.total) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (p.failed === 0) setStage({ kind: 'done', spec, all, moving, written: p.written });
        }
      } catch (error) {
        if (error instanceof BridgeError && error.kind === 'cooling_down') return;
        setStage((s) => (s.kind === 'writing' ? { ...s, error: error instanceof Error ? error.message : 'Ferry did not answer.' } : s));
      }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 1500);
  }, []);

  const enqueue = async (facts: ReviewFact[]): Promise<string | null> => {
    const payload: CandidateFact[] = facts.map((f) => ({ ...f.fact, text: review.edits[f.fact.id] ?? f.fact.text }));
    try {
      for (let i = 0; i < payload.length; i += 2000) {
        await bridge({ type: 'import.enqueue', facts: payload.slice(i, i + 2000) }, { timeoutMs: 30_000 });
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Ferry did not accept the facts.';
    }
  };

  const move = async (spec: SourceSpec, all: ReviewFact[]) => {
    const moving = factsToMove(all, review);
    setProgress(null);
    setStage({ kind: 'writing', spec, all, moving, error: null });
    const error = await enqueue(moving);
    if (error) {
      setStage({ kind: 'writing', spec, all, moving, error });
      return;
    }
    follow(spec, all, moving);
  };

  const retryFailed = async () => {
    if (stage.kind !== 'writing') return;
    setRetrying(true);
    // Candidate ids are stable, so the extension skips facts it already wrote.
    const error = await enqueue(stage.moving.slice(progress?.written ?? 0));
    setRetrying(false);
    if (error) setStage({ ...stage, error });
    else follow(stage.spec, stage.all, stage.moving);
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    abortRef.current?.abort();
    setProgress(null);
    setStage({ kind: 'pick' });
  };

  /* ---------------------------------------------------------------- */

  if (stage.kind === 'done') {
    const perSource = new Map<Vendor, number>();
    for (const f of stage.moving) for (const v of new Set(f.fact.receipts.map((r) => r.vendor))) perSource.set(v, (perSource.get(v) ?? 0) + 1);
    const found = stage.all.filter((f) => f.group === 'normal' || f.group === 'sensitive').length;
    return (
      <HeroMetric
        vendor={stage.spec.kind}
        found={found}
        owned={stage.written}
        perSource={[...perSource.entries()]}
        accountId={status.accountId ?? null}
        onAnother={reset}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Rescue"
        actions={
          stage.kind !== 'pick' && stage.kind !== 'writing' ? (
            <Button variant="ghost" icon={Undo2} onClick={reset}>
              Start over
            </Button>
          ) : null
        }
      >
        Bring what your AIs know about you into something you own. Parsing happens on this device.
      </PageHeader>

      {stage.kind === 'pick' ? <SourcePicker onPick={(spec) => setStage({ kind: 'input', spec, error: null })} /> : null}

      {stage.kind === 'input' ? (
        <div className="flex max-w-[720px] flex-col gap-4">
          <h2 className="text-title font-semibold text-text-primary">{stage.spec.title}</h2>
          {stage.spec.kind === 'paste' ? (
            <PasteBox error={stage.error} onSubmit={(text) => void runImport(stage.spec, { type: 'import.paste', text })} />
          ) : (
            <Dropzone spec={stage.spec} error={stage.error} onFile={(file) => void onFile(stage.spec, file)} />
          )}
        </div>
      ) : null}

      {stage.kind === 'parsing' || stage.kind === 'distilling' || stage.kind === 'finishing' ? (
        <div className="flex max-w-[640px] flex-col gap-6" aria-live="polite">
          <ParseSteps stage={stage} />
          <p className="text-small text-text-tertiary">
            The raw export stays on this device. Only short chunks of your own messages go to Ferry Distill, which keeps no logs.
          </p>
          {stage.kind === 'distilling' && stage.error ? (
            <Notice
              tone="danger"
              live
              action={
                <Button
                  size="sm"
                  icon={RotateCw}
                  onClick={() => {
                    const size = batches(stage.result.chunks)[0]?.length ?? 1;
                    void distillFrom(stage.spec, stage.result, Math.floor(stage.done / size), stage.facts);
                  }}
                >
                  Resume
                </Button>
              }
            >
              {stage.error}
            </Notice>
          ) : null}
        </div>
      ) : null}

      {stage.kind === 'review' ? (
        <ReviewStep facts={stage.facts} review={review} setReview={setReview} onReceipt={setReceipt} onMove={() => void move(stage.spec, stage.facts)} />
      ) : null}

      {stage.kind === 'writing' ? (
        <div className="flex flex-col gap-6">
          {stage.error ? (
            <Notice
              tone="danger"
              live
              action={
                <Button size="sm" icon={RotateCw} onClick={() => void move(stage.spec, stage.all)}>
                  Try again
                </Button>
              }
            >
              {stage.error}
            </Notice>
          ) : null}
          <WritingStep facts={stage.moving} texts={review.edits} progress={progress} onRetry={() => void retryFailed()} retrying={retrying} />
        </div>
      ) : null}

      <ReceiptView target={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

export function RescueView() {
  return <ExtensionGate title="Rescue">{(status) => <RescueScreen status={status} />}</ExtensionGate>;
}

import { CONTEXT_HEADER } from '@ferry/core';
import { DemoLabel, SourceBadge, StatusPill } from '@ferry/ui/components/badge';
import { VerifyCheck } from '@ferry/ui/components/verify';
import { ArrowUpRight, Unplug } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { preload } from 'react-dom';
import { FerryMark, Wordmark } from '@/components/ferry-mark';
import { DemoVideo } from '@/components/landing/demo-video';
import { InstallCta } from '@/components/landing/install-cta';
import { ThemeToggle } from '@/components/theme-toggle';
import { publicEnv } from '@/lib/env';
import { walrusSources } from '@/lib/links';
import { readStats } from '@/lib/stats';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

const wrap = 'mx-auto w-full max-w-[1200px] px-4 md:px-8';

/** Static ticket stub for the hero. Example content, so it carries the DEMO label. */
function TicketStub() {
  return (
    <figure className="relative rounded-lg border border-border-hairline bg-surface-1 shadow-3">
      <div className="flex items-center justify-between gap-3 px-6 pb-3 pt-5">
        <span className="text-title font-semibold text-text-primary">Receipt</span>
        <DemoLabel />
      </div>
      <div className="px-6">
        <p className="text-small font-medium text-text-secondary">Constraint</p>
        <blockquote className="mt-2 border-l-2 border-accent pl-4 text-body-lg text-text-primary">
          {'“I’m allergic to cashews, so no satay sauce for me.”'}
        </blockquote>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SourceBadge vendor="chatgpt" />
          <SourceBadge vendor="claude" />
          <span className="text-small text-text-tertiary">Heard in two apps</span>
        </div>
      </div>
      <div aria-hidden="true" className="relative my-6 h-0">
        <div className="ferry-perforation mx-4" />
        <span className="absolute left-0 top-0 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg" />
        <span className="absolute right-0 top-0 size-4 -translate-y-1/2 translate-x-1/2 rounded-full bg-bg" />
      </div>
      <dl className="grid grid-cols-[132px_1fr] gap-x-4 gap-y-2.5 px-6 text-small">
        <dt className="text-text-secondary">Walrus blob</dt>
        <dd className="font-mono text-[0.8125rem] text-text-primary">Hx3k9q...Tw0c</dd>
        <dt className="text-text-secondary">Owner</dt>
        <dd className="font-mono text-[0.8125rem] text-text-primary">0x4a1c...9e02</dd>
        <dt className="text-text-secondary">Stored until</dt>
        <dd className="tabular text-text-primary">epoch 412</dd>
        <dt className="text-text-secondary">Read through</dt>
        <dd className="text-text-primary">Tatum Sui gRPC</dd>
      </dl>
      <div className="mt-5 flex items-center gap-2.5 border-t border-border-hairline px-6 py-4 text-small text-success">
        <VerifyCheck state="static" size={24} />
        Verified. Blob matches its id on Walrus.
      </div>
      <figcaption className="sr-only">An example receipt: the quote, where it was heard, and where it is stored.</figcaption>
    </figure>
  );
}

function Feature({ title, children, visual }: { title: string; children: ReactNode; visual: ReactNode }) {
  return (
    <section className="grid items-start gap-8 border-t border-border-hairline py-16 first:border-t-0 md:grid-cols-12 md:gap-6 md:py-24">
      <div className="flex flex-col gap-4 md:col-span-5">
        <h2 className="ferry-display-md text-display-md text-text-primary">{title}</h2>
        <div className="flex max-w-[56ch] flex-col gap-3 text-body-lg text-text-secondary">{children}</div>
      </div>
      <div className="md:col-span-6 md:col-start-7">{visual}</div>
    </section>
  );
}

const panel = 'rounded-md border border-border-hairline bg-surface-1 p-5 shadow-1';

function RescueVisual() {
  const steps = ['Unzipping on this device', 'Finding your messages', 'Distilling facts', 'Checking for sensitive details', 'Removing duplicates'];
  return (
    <div className={panel}>
      <div className="flex items-center justify-between text-small font-medium text-text-secondary">
        <span>ChatGPT</span>
        <span>Walrus Mainnet</span>
      </div>
      <div aria-hidden="true" className="ferry-waterline my-3" />
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, i) => (
          <li key={step} className="flex items-center gap-3 text-body text-text-secondary">
            <span className="flex size-6 items-center justify-center rounded-full bg-surface-3 text-micro font-medium tabular text-text-tertiary">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CarryVisual() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="inline-flex h-7 items-center gap-2 rounded-full border border-border-hairline bg-surface-1 py-1 pl-1.5 pr-2.5 text-small font-medium text-text-primary shadow-2">
          <FerryMark size={18} />
          Ferry has 2 things Claude should know
          <kbd className="ml-1 rounded-xs border border-border-hairline px-1 text-micro text-text-tertiary">Alt I</kbd>
        </span>
        <DemoLabel />
      </div>
      {/* Focusable so keyboard users can scroll it when the block is wider than the card. */}
      <pre
        tabIndex={0}
        className="overflow-x-auto rounded-md bg-surface-3 p-4 font-mono text-[0.8125rem] leading-5 text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
      >
        {`${CONTEXT_HEADER}\n- Allergic to cashews\n- Vegetarian since 2019`}
      </pre>
      <p className="text-small text-text-tertiary">You see the exact block before it goes into the chat. Nothing is inserted without a click.</p>
    </div>
  );
}

function BlackoutVisual() {
  return (
    <div className={`${panel} flex flex-col gap-4`}>
      <div className="flex items-start gap-2 rounded-sm bg-warning-subtle px-4 py-3 text-body text-text-primary">
        <Unplug size={16} strokeWidth={1.75} className="mt-[3px] shrink-0 text-warning" aria-hidden="true" />
        <span className="flex-1">This simulates Claude cutting you off. Your memory lives on Walrus, not inside Claude.</span>
        <DemoLabel />
      </div>
      <div aria-hidden="true" className="ferry-waterline" />
      <p className="text-body font-medium text-accent">Continuing on GPT, with the same facts recalled from Walrus.</p>
    </div>
  );
}

function ShareVisual() {
  const lines: [string, string][] = [
    ['Agent', 'POST /v1/cards/:id/recall'],
    ['Gate', '402 Payment Required, 0.01 USDC on Sui'],
    ['Agent', 'pays your address, sends the proof'],
    ['Gate', 'checks the payment through Tatum'],
    ['Gate', '200, facts from your Share Card with receipts'],
  ];
  return (
    <ol className={`${panel} flex flex-col gap-2 font-mono text-[0.8125rem]`}>
      {lines.map(([who, what], i) => (
        <li key={i} className="grid grid-cols-[56px_1fr] gap-3">
          <span className="text-text-tertiary">{who}</span>
          <span className="text-text-primary">{what}</span>
        </li>
      ))}
    </ol>
  );
}

function ReceiptVisual() {
  return (
    <div className={`${panel} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status="active" />
        <StatusPill status="superseded" />
        <StatusPill status="conflict" />
        <StatusPill status="hidden" />
      </div>
      <p className="text-body-lg text-text-secondary">
        Each fact knows its source, its date, and whether a newer fact replaced it. Conflicts wait for you to decide. Hidden facts are never
        inserted again.
      </p>
    </div>
  );
}

function CounterCell({ label, value }: { label: string; value: number | null }) {
  return (
    <Link href="/proofs" className="group flex flex-col gap-1 rounded-sm py-2">
      <span className="text-body text-text-secondary group-hover:text-text-primary">{label}</span>
      {value === null ? (
        <span className="text-title font-medium text-text-tertiary">Counting on Mainnet</span>
      ) : (
        <span className="tabular text-display-md font-semibold tracking-[-0.02em] text-text-primary">{value.toLocaleString('en-US')}</span>
      )}
    </Link>
  );
}

/** Fonts the first screen paints with, fetched alongside the CSS instead of after it (DESIGN 2.2). */
const LANDING_FONTS = ['/fonts/bricolage-display-latin.woff2', '/fonts/geist-latin.woff2'] as const;

export default async function Landing() {
  for (const href of LANDING_FONTS) preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const stats = await readStats();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-sm focus:bg-surface-2 focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className={`${wrap} flex h-16 items-center justify-between`}>
        <Link href="/" aria-label="Ferry home" className="rounded-sm">
          <Wordmark />
        </Link>
        <nav aria-label="Site" className="flex items-center gap-2 text-body">
          <Link href="/proofs" className="hidden h-8 items-center rounded-sm px-2 text-text-secondary hover:text-text-primary sm:inline-flex">
            Proofs
          </Link>
          <a href={publicEnv.repoUrl} className="hidden h-8 items-center rounded-sm px-2 text-text-secondary hover:text-text-primary sm:inline-flex">
            Source code
          </a>
          <Link href="/start" className="mr-2 inline-flex h-8 items-center rounded-sm px-2 font-medium text-text-primary hover:text-accent">
            Open app
          </Link>
          <ThemeToggle initial={theme} />
        </nav>
      </header>

      <main id="main">
        <section className={`${wrap} grid items-center gap-12 pb-16 pt-16 md:pt-24 lg:grid-cols-12 lg:gap-6 lg:pb-24 lg:pt-32`}>
          <div className="flex flex-col gap-8 lg:col-span-7">
            <h1 className="ferry-display max-w-[12ch] text-display-xl text-text-primary">Your AI memory, finally yours.</h1>
            <p className="max-w-[48ch] text-body-lg text-text-secondary">
              Ferry keeps one memory that follows you across ChatGPT, Claude and Gemini. It lives on Walrus, belongs to your Sui wallet, and every
              fact shows where it came from.
            </p>
            <InstallCta extensionId={publicEnv.extensionId} releaseUrl={publicEnv.releaseUrl} />
          </div>
          <div className="lg:col-span-5">
            {publicEnv.demoVideoUrl ? <DemoVideo src={publicEnv.demoVideoUrl} /> : <TicketStub />}
          </div>
        </section>

        <section aria-label="Live counts" className="border-y border-border-hairline bg-surface-1">
          <div className={`${wrap} grid gap-6 py-8 sm:grid-cols-2`}>
            <CounterCell label="Memories on Walrus Mainnet" value={stats.memories} />
            <CounterCell label="Paid recalls settled on Sui" value={stats.paidRecalls} />
          </div>
        </section>

        <div className={wrap}>
          <Feature title="Rescue what they know" visual={<RescueVisual />}>
            <p>
              Drop your ChatGPT, Claude or Gemini export. Ferry reads it on your device, finds the durable facts about you, and lets you approve
              each one before it moves to Walrus.
            </p>
            <p>Sensitive details stay out unless you include them. Text that reads like instructions to an AI is quarantined, never saved.</p>
          </Feature>

          <Feature title="Carry it into the next chat" visual={<CarryVisual />}>
            <p>
              Tell one AI something. The next one already knows. When you start typing in another app, Ferry offers the few facts that fit, and
              you insert them with one click.
            </p>
          </Feature>

          <Feature title="See the receipt" visual={<ReceiptVisual />}>
            <p>
              Every fact carries the quote it came from, the app and the date. Its Walrus blob, owner and storage epochs are read live from Sui
              through Tatum, and Verify refetches the blob to check it.
            </p>
          </Feature>

          <Feature title="Run the Blackout Drill" visual={<BlackoutVisual />}>
            <p>
              Chat in Ferry Desk, then cut the model off. The thread continues on another provider with the same memory, and Ferry counts how
              many facts were lost by recalling them again.
            </p>
          </Feature>

          <Feature title="Share and earn" visual={<ShareVisual />}>
            <p>
              Publish a small Share Card, like your food preferences. Agents pay you per recall in USDC on Sui, straight to your address. They see
              only what is on the card, never your private memory.
            </p>
          </Feature>

          <section aria-labelledby="walrus-words" className="border-t border-border-hairline py-16 md:py-24">
            <h2 id="walrus-words" className="ferry-display-md mb-8 text-display-md text-text-primary">
              What Walrus said this week
            </h2>
            <ul className="grid gap-6 md:grid-cols-3">
              {[
                {
                  date: '5 Nov',
                  text: 'Everyone shipped AI memory in October, but who actually owns it? Memory you cannot take with you is storage rented from one vendor.',
                  href: walrusSources.blog,
                },
                {
                  date: '8 Nov',
                  text: 'A good assistant remembers what you said. A great one shows where it heard it.',
                  href: walrusSources.profile,
                },
                {
                  date: '4 Nov',
                  text: 'Agents need context that stays current, not decisions that went out of date.',
                  href: walrusSources.profile,
                },
              ].map((item) => (
                <li key={item.date} className="flex flex-col gap-3 border-l-2 border-accent pl-4">
                  <p className="text-body-lg text-text-primary">{item.text}</p>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-small text-text-secondary underline-offset-[3px] hover:text-accent hover:underline"
                  >
                    {`Walrus, ${item.date}, paraphrased`}
                    <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="honesty" className="grid gap-8 border-t border-border-hairline py-16 md:grid-cols-12 md:gap-6 md:py-24">
            <h2 id="honesty" className="ferry-display-md text-display-md text-text-primary md:col-span-5">
              What Ferry can and cannot promise
            </h2>
            <div className="flex max-w-[56ch] flex-col gap-5 text-body-lg text-text-secondary md:col-span-6 md:col-start-7">
              <p>
                Standard mode: the hosted Walrus Memory relayer encrypts and stores your facts, but it sees the text while it processes them. That
                is convenient, and it is not end to end encryption. Vault mode: your browser creates the search embeddings and encrypts each fact
                with Seal before anything leaves this device, so the relayer never sees the text. It still sees the encrypted vectors, your account
                owner address, the namespace and when you search.
              </p>
              <p>
                Forget means hidden: Ferry writes a tombstone so no device inserts the fact again. Walrus Memory has no delete, so the encrypted
                copy stays in Walrus storage until its storage epoch ends. Ferry shows you that epoch.
              </p>
            </div>
          </section>
        </div>

        <section className="border-t border-border-hairline bg-surface-1">
          <div className={`${wrap} flex flex-col items-start gap-8 py-16 md:py-24`}>
            <h2 className="ferry-display text-display-lg text-text-primary">Switch AIs. Keep yourself.</h2>
            <InstallCta extensionId={publicEnv.extensionId} releaseUrl={publicEnv.releaseUrl} />
          </div>
        </section>
      </main>

      <footer className={`${wrap} flex flex-wrap items-center justify-between gap-4 py-8 text-small text-text-tertiary`}>
        <span>Ferry is open source under the MIT license.</span>
        <nav aria-label="Footer" className="flex gap-3">
          <a href={publicEnv.repoUrl} className="inline-flex h-6 items-center hover:text-text-primary">
            Source code
          </a>
          <Link href="/proofs" className="inline-flex h-6 items-center hover:text-text-primary">
            Proofs
          </Link>
          <a href={walrusSources.memoryDocs} className="inline-flex h-6 items-center hover:text-text-primary">
            Walrus docs
          </a>
        </nav>
      </footer>
    </>
  );
}

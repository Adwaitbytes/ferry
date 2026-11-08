'use client';

import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../cn';

export function truncateId(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 3 ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export interface MonoIdProps {
  value: string;
  /** Spoken kind, for example "Blob id" or "Sui address". */
  kind: string;
  href?: string | undefined;
  hrefLabel?: string | undefined;
  copy?: boolean | undefined;
  full?: boolean | undefined;
  className?: string | undefined;
}

/** Truncated id with copy and optional explorer link (DESIGN 7.18). */
export function MonoId({ value, kind, href, hrefLabel = 'Open in Sui explorer', copy = true, full = false, className }: MonoIdProps) {
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setAnnouncement('Copied');
    } catch {
      setAnnouncement('Could not copy. Select the id and copy it by hand.');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setAnnouncement('');
    }, 1500);
  };

  const CopyIcon = copied ? Check : Copy;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-0.5', className)}>
      <span title={value} className="truncate font-mono text-[0.8125rem] text-text-primary">
        <span aria-hidden="true">{full ? value : truncateId(value)}</span>
        <span className="sr-only">{`${kind} ${value}`}</span>
      </span>
      {copy ? (
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label={`Copy ${kind.toLowerCase()}`}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
        >
          <CopyIcon size={14} strokeWidth={1.75} aria-hidden="true" className={copied ? 'text-success' : undefined} />
        </button>
      ) : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={hrefLabel}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
        >
          <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </a>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </span>
  );
}

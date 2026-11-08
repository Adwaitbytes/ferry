'use client';

import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../cn';

const KEYWORDS = new Set([
  'import', 'from', 'export', 'const', 'let', 'await', 'async', 'function', 'return', 'new', 'if', 'else',
  'for', 'of', 'type', 'interface', 'true', 'false', 'null', 'undefined', 'curl', 'GET', 'POST',
]);

type Token = { kind: 'keyword' | 'string' | 'comment' | 'plain'; text: string };

// Comments, quoted strings (three kinds), identifiers, then any single other character.
const TOKEN_RE = /(\/\/[^\n]*|#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*)|([\s\S])/g;

/** Splits code into a four-color token stream (DESIGN 7.17). Output is React text, never HTML. */
export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  for (const match of code.matchAll(TOKEN_RE)) {
    const [, comment, str, word, other] = match;
    let token: Token;
    if (comment !== undefined) token = { kind: 'comment', text: comment };
    else if (str !== undefined) token = { kind: 'string', text: str };
    else if (word !== undefined) token = { kind: KEYWORDS.has(word) ? 'keyword' : 'plain', text: word };
    else token = { kind: 'plain', text: other ?? '' };
    const last = tokens.at(-1);
    if (last && last.kind === token.kind && token.kind === 'plain') last.text += token.text;
    else tokens.push(token);
  }
  return tokens;
}

const tokenClass: Record<Token['kind'], string | undefined> = {
  keyword: 'text-accent',
  string: 'text-info',
  comment: 'text-text-tertiary',
  plain: undefined,
};

export interface CodeBlockProps {
  code: string;
  title?: string | undefined;
  highlight?: boolean | undefined;
  className?: string | undefined;
  footer?: ReactNode | undefined;
}

export function CodeBlock({ code, title, highlight = true, className, footer }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const CopyIcon = copied ? Check : Copy;
  return (
    <figure className={cn('overflow-hidden rounded-md bg-surface-3', className)}>
      <div className="flex h-10 items-center justify-between border-b border-border-hairline pl-4 pr-2">
        <figcaption className="text-small text-text-secondary">{title ?? 'Code'}</figcaption>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-small font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary"
        >
          <CopyIcon size={14} strokeWidth={1.75} aria-hidden="true" />
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {/* Focusable so keyboard users can scroll long lines (axe scrollable-region-focusable). */}
      <pre
        tabIndex={0}
        className="overflow-x-auto p-4 font-mono text-[0.8125rem] leading-5 text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
      >
        <code>
          {highlight
            ? tokenize(code).map((token, index) => (
                <span key={index} className={tokenClass[token.kind]}>
                  {token.text}
                </span>
              ))
            : code}
        </code>
      </pre>
      {footer ? <div className="border-t border-border-hairline px-4 py-3 text-small text-text-secondary">{footer}</div> : null}
    </figure>
  );
}

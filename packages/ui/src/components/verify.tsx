import { cn } from '../cn';

export interface VerifyCheckProps {
  /** `verified` draws the stamp once; `static` shows it finished; `idle` renders nothing visible. */
  state: 'idle' | 'verified' | 'static';
  size?: 20 | 24 | 32 | 40 | undefined;
  className?: string | undefined;
}

/** The stamp that draws itself after a real verification (DESIGN 5.3 D). Decorative: pair it with text. */
export function VerifyCheck({ state, size = 20, className }: VerifyCheckProps) {
  if (state === 'idle') return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      data-state={state}
      className={cn('shrink-0', className)}
    >
      <circle cx="12" cy="12" r="10" pathLength={1} className="ferry-verify-ring" />
      <path d="M7.5 12.5l3 3 6-6.5" pathLength={1} className="ferry-verify-check" />
    </svg>
  );
}

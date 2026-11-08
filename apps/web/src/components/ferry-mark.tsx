import { cn } from '@ferry/ui/cn';

/** The Ferry mark: a circle with a waterline through it. Drawn, not an illustration. */
export function FerryMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" className={cn('shrink-0 text-accent', className)}>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M2.5 11h15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <FerryMark />
      <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em] text-text-primary [font-variation-settings:'opsz'_24]">
        Ferry
      </span>
    </span>
  );
}

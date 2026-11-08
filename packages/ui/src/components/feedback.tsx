import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

/** A spinner is never shown alone (DESIGN 10): the step is always named. */
export function LoadingText({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <p role="status" className={cn('inline-flex items-center gap-2 text-small text-text-secondary', className)}>
      <LoaderCircle size={14} strokeWidth={1.75} className="ferry-spin shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export interface ProgressProps {
  label: string;
  value: number;
  max: number;
  /** Text for the right of the label row, for example "142 of 214". */
  valueText?: ReactNode | undefined;
  /** Spoken value, for example "142 of 214 facts moved". */
  ariaValueText: string;
  helper?: ReactNode | undefined;
  tone?: 'accent' | 'warning' | 'danger' | undefined;
  className?: string | undefined;
}

const toneFill = { accent: 'bg-accent', warning: 'bg-warning', danger: 'bg-danger' } as const;

/** Never a bar alone (DESIGN 7.12). */
export function Progress({ label, value, max, valueText, ariaValueText, helper, tone = 'accent', className }: ProgressProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-4 text-body">
        <span className="font-medium text-text-primary">{label}</span>
        {valueText ? <span className="tabular text-text-secondary">{valueText}</span> : null}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={ariaValueText}
        className="h-1 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cn('h-full origin-left rounded-full transition-transform duration-200 ease-linear', toneFill[tone])}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      {helper ? <p className="text-small text-text-tertiary">{helper}</p> : null}
    </div>
  );
}

export function IndeterminateProgress({ label, helper, className }: { label: string; helper?: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="text-body font-medium text-text-primary">{label}</span>
      <div role="progressbar" aria-label={label} aria-valuetext={label} className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
        <div className="ferry-indeterminate h-full w-[30%] rounded-full bg-accent" />
      </div>
      {helper ? <p className="text-small text-text-tertiary">{helper}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string | undefined }) {
  return <div aria-hidden="true" className={cn('ferry-skeleton rounded-sm bg-surface-3', className)} />;
}

/** Wraps skeletons with a busy region and a spoken description (DESIGN 7.13). */
export function SkeletonGroup({ label, children, className }: { label: string; children: ReactNode; className?: string | undefined }) {
  return (
    <div aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode | undefined;
  secondary?: ReactNode | undefined;
  className?: string | undefined;
}

/** Left aligned, teaches what will appear and how (DESIGN 7.14). No illustrations. */
export function EmptyState({ icon: Icon, title, children, action, secondary, className }: EmptyStateProps) {
  return (
    <div className={cn('flex max-w-[420px] flex-col items-start gap-3', className)}>
      <span className="flex size-10 items-center justify-center rounded-md bg-surface-3 text-text-secondary">
        <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h3 className="text-title font-semibold text-text-primary">{title}</h3>
      <div className="text-body text-text-secondary">{children}</div>
      {action || secondary ? (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {action}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

const noticeSpec: Record<NoticeTone, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: 'bg-info-subtle text-info' },
  warning: { icon: TriangleAlert, className: 'bg-warning-subtle text-warning' },
  danger: { icon: CircleAlert, className: 'bg-danger-subtle text-danger' },
  success: { icon: CircleCheck, className: 'bg-success-subtle text-success' },
};

export interface NoticeProps {
  tone?: NoticeTone | undefined;
  title?: string | undefined;
  children: ReactNode;
  action?: ReactNode | undefined;
  /** Errors interrupt; everything else is polite. */
  live?: boolean | undefined;
  className?: string | undefined;
}

export function Notice({ tone = 'info', title, children, action, live, className }: NoticeProps) {
  const spec = noticeSpec[tone];
  const Icon = spec.icon;
  const role = live ? (tone === 'danger' ? 'alert' : 'status') : undefined;
  return (
    <div role={role} className={cn('flex items-start gap-3 rounded-md px-4 py-3', spec.className, className)}>
      <Icon size={16} strokeWidth={1.75} className="mt-[3px] shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-body">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className="text-text-primary">{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** The waterline (DESIGN 1): divides where it came from (above) and what you own (below). */
export function Waterline({ className }: { className?: string | undefined }) {
  return <hr aria-hidden="true" className={cn('ferry-waterline', className)} />;
}

/** Ticket perforation with side notches cut in the drawer's own background. */
export function Perforation({ className, notchClassName = 'bg-bg' }: { className?: string; notchClassName?: string | undefined }) {
  return (
    <div aria-hidden="true" className={cn('relative my-6 h-0', className)}>
      <div className="ferry-perforation mx-4" />
      <span className={cn('absolute left-0 top-0 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full', notchClassName)} />
      <span className={cn('absolute right-0 top-0 size-4 translate-x-1/2 -translate-y-1/2 rounded-full', notchClassName)} />
    </div>
  );
}

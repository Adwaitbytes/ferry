import type { MemoryStatus, Vendor } from '@ferry/core';
import { Check, CircleDot, EyeOff, GitCompareArrows, Replace, ShieldAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

export type BadgeVariant = 'neutral' | 'accent' | 'warning' | 'danger' | 'info';

const badgeVariants: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-3 text-text-secondary',
  accent: 'bg-accent-subtle text-accent',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
};

export interface BadgeProps {
  variant?: BadgeVariant | undefined;
  icon?: LucideIcon | undefined;
  children: ReactNode;
  className?: string | undefined;
}

export function Badge({ variant = 'neutral', icon: Icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-micro font-medium',
        badgeVariants[variant],
        className,
      )}
    >
      {Icon ? <Icon size={12} strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/**
 * Marks simulated content (DESIGN 9.3). The only all-caps text in Ferry: it is a legal style
 * marker, not a label. Never placed on real Mainnet data.
 */
export function DemoLabel({ className }: { className?: string | undefined }) {
  const description = 'Simulated for the demo. Not a real outage or payment.';
  return (
    <span
      title={description}
      aria-label={`DEMO. ${description}`}
      role="note"
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border border-dashed border-text-secondary px-2 text-micro font-semibold tracking-[0.06em] text-text-secondary',
        className,
      )}
    >
      DEMO
    </span>
  );
}

export const VENDOR_LABEL: Record<Vendor, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  paste: 'Paste',
  desk: 'Ferry Desk',
  manual: 'Typed in Ferry',
};

const vendorDot: Record<Vendor, string> = {
  chatgpt: 'var(--ferry-vendor-chatgpt)',
  claude: 'var(--ferry-vendor-claude)',
  gemini: 'var(--ferry-vendor-gemini)',
  paste: 'var(--ferry-vendor-paste)',
  desk: 'var(--ferry-accent)',
  manual: 'var(--ferry-vendor-paste)',
};

/** Vendor as a text label with a decorative dot. No trademark logos (DESIGN 3.6). */
export function SourceBadge({ vendor, className }: { vendor: Vendor; className?: string | undefined }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-3 px-2 text-micro font-medium text-text-secondary',
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: vendorDot[vendor] }} />
      {/* aria-label is not allowed on a plain span (axe aria-prohibited-attr), so the spoken prefix is text. */}
      <span className="sr-only">Source: </span>
      <span>{VENDOR_LABEL[vendor]}</span>
    </span>
  );
}

export function SourceBadges({ vendors, className }: { vendors: readonly Vendor[]; className?: string | undefined }) {
  const unique = [...new Set(vendors)];
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {unique.map((vendor) => (
        <SourceBadge key={vendor} vendor={vendor} />
      ))}
    </span>
  );
}

export type PillStatus = MemoryStatus | 'approved';

const statusSpec: Record<PillStatus, { label: string; icon: LucideIcon; tone: string }> = {
  active: { label: 'Active', icon: CircleDot, tone: 'active' },
  approved: { label: 'Approved', icon: Check, tone: 'active' },
  superseded: { label: 'Superseded', icon: Replace, tone: 'superseded' },
  hidden: { label: 'Hidden', icon: EyeOff, tone: 'hidden' },
  conflict: { label: 'Conflict', icon: GitCompareArrows, tone: 'conflict' },
  quarantine: { label: 'Quarantined', icon: ShieldAlert, tone: 'quarantine' },
};

/** Status is icon plus text, color third (DESIGN 3.5). */
export function StatusPill({ status, className }: { status: PillStatus; className?: string | undefined }) {
  const spec = statusSpec[status];
  const Icon = spec.icon;
  return (
    <span
      className={cn('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-micro font-medium', className)}
      style={{ color: `var(--ferry-status-${spec.tone}-fg)`, backgroundColor: `var(--ferry-status-${spec.tone}-bg)` }}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {spec.label}
    </span>
  );
}

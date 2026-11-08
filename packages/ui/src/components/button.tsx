import { LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium ' +
  'transition-[background-color,color,border-color,box-shadow] duration-150 ease-out ' +
  'active:translate-y-px active:transition-none ' +
  'disabled:cursor-not-allowed aria-disabled:cursor-not-allowed';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-press ' +
    'disabled:bg-surface-3 disabled:text-text-disabled disabled:shadow-none',
  secondary:
    'border border-border-hairline bg-surface-2 text-text-primary shadow-1 hover:bg-surface-3 active:bg-surface-3 ' +
    'disabled:bg-surface-1 disabled:text-text-disabled disabled:shadow-none',
  ghost:
    'text-text-secondary hover:bg-surface-3 hover:text-text-primary active:bg-surface-3 disabled:text-text-disabled disabled:hover:bg-transparent',
  danger:
    'border border-[color-mix(in_srgb,var(--ferry-danger)_40%,transparent)] bg-danger-subtle text-danger ' +
    'hover:bg-danger hover:text-[var(--ferry-bg)] disabled:text-text-disabled',
  link: 'h-auto px-0 text-accent underline-offset-[3px] hover:underline disabled:text-text-disabled',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 rounded-sm px-2.5 text-small',
  md: 'h-9 rounded-sm px-3.5 text-body',
  lg: 'h-11 rounded-sm px-[18px] text-body-lg',
};

const iconSizes: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  icon?: LucideIcon | undefined;
  /** Shows a spinner in place of the icon and swaps the label to the progressive verb. */
  loading?: boolean | undefined;
  loadingLabel?: string | undefined;
  kbd?: string | undefined;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  loadingLabel,
  kbd,
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  const iconSize = iconSizes[size];
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], variant !== 'link' && sizes[size], variant === 'link' && 'text-body', className)}
      {...rest}
    >
      {loading ? (
        <LoaderCircle size={iconSize} strokeWidth={1.75} className="ferry-spin" aria-hidden="true" />
      ) : Icon ? (
        <Icon size={iconSize} strokeWidth={1.75} aria-hidden="true" />
      ) : null}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
      {kbd ? <Kbd className="ml-1">{kbd}</Kbd> : null}
    </button>
  );
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: LucideIcon;
  /** Required: icon-only buttons are announced by this label. */
  label: string;
  size?: 'sm' | 'md' | undefined;
  variant?: 'ghost' | 'secondary' | undefined;
}

export function IconButton({ icon: Icon, label, size = 'md', variant = 'ghost', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm text-text-secondary transition-colors duration-150 ease-out',
        'hover:bg-surface-3 hover:text-text-primary active:translate-y-px disabled:cursor-not-allowed disabled:text-text-disabled',
        variant === 'secondary' && 'border border-border-hairline bg-surface-2',
        size === 'sm' ? 'size-7' : 'size-9',
        className,
      )}
      {...rest}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border-hairline bg-surface-2 px-1 font-sans text-micro text-text-tertiary',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

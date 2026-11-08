'use client';

import { CircleAlert, Search, X } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../cn';
import { Kbd } from './button';

const control =
  'w-full rounded-sm border border-border-control bg-surface-2 px-3 text-body text-text-primary placeholder:text-text-tertiary ' +
  'transition-[border-color] duration-150 ease-out hover:border-text-tertiary focus-visible:border-accent ' +
  'disabled:cursor-not-allowed disabled:bg-surface-1 disabled:text-text-disabled ' +
  'aria-invalid:border-danger';

interface FieldShellProps {
  id: string;
  label: string;
  hideLabel?: boolean | undefined;
  helper?: ReactNode | undefined;
  error?: string | null | undefined;
  trailingLabel?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}

function FieldShell({ id, label, hideLabel, helper, error, trailingLabel, children, className }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className={cn('flex items-baseline justify-between gap-3', hideLabel && 'sr-only')}>
        <label htmlFor={id} className="text-small font-medium text-text-secondary">
          {label}
        </label>
        {trailingLabel ? <span className="text-small text-text-tertiary tabular">{trailingLabel}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-small text-danger">
          <CircleAlert size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : helper ? (
        <p id={`${id}-helper`} className="text-small text-text-tertiary">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: string;
  hideLabel?: boolean | undefined;
  helper?: ReactNode | undefined;
  error?: string | null | undefined;
  suffix?: string | undefined;
  fieldClassName?: string | undefined;
}

export function Input({ label, hideLabel, helper, error, suffix, className, fieldClassName, ...rest }: InputProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : helper ? `${id}-helper` : undefined;
  return (
    <FieldShell id={id} label={label} hideLabel={hideLabel} helper={helper} error={error ?? null} className={fieldClassName}>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(control, 'h-9', suffix && 'pr-14', className)}
          {...rest}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-small text-text-tertiary">{suffix}</span>
        ) : null}
      </div>
    </FieldShell>
  );
}

export interface SearchInputProps extends Omit<ComponentProps<'input'>, 'id' | 'type' | 'onChange' | 'value'> {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  shortcut?: string | undefined;
}

export function SearchInput({ label, value, onValueChange, shortcut = '/', className, ...rest }: SearchInputProps) {
  const id = useId();
  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search size={16} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(control, 'h-9 pl-9 pr-16 [&::-webkit-search-cancel-button]:hidden')}
        {...rest}
      />
      <div className="absolute inset-y-0 right-2 flex items-center gap-1">
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onValueChange('')}
            className="inline-flex size-6 items-center justify-center rounded-xs text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
          >
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : (
          <Kbd>{shortcut}</Kbd>
        )}
      </div>
    </div>
  );
}

export interface TextareaProps extends Omit<ComponentProps<'textarea'>, 'id'> {
  label: string;
  hideLabel?: boolean | undefined;
  helper?: ReactNode | undefined;
  error?: string | null | undefined;
  /** Shows "212 of 500" next to the label. */
  showCount?: boolean | undefined;
  fieldClassName?: string | undefined;
}

export function Textarea({ label, hideLabel, helper, error, showCount, maxLength, value, className, fieldClassName, ...rest }: TextareaProps) {
  const id = useId();
  const length = typeof value === 'string' ? value.length : 0;
  const describedBy = error ? `${id}-error` : helper ? `${id}-helper` : undefined;
  return (
    <FieldShell
      id={id}
      label={label}
      hideLabel={hideLabel}
      helper={helper}
      error={error ?? null}
      className={fieldClassName}
      trailingLabel={showCount && maxLength ? `${length} of ${maxLength}` : null}
    >
      <textarea
        id={id}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(control, 'min-h-24 resize-y py-2 leading-[1.5714]', className)}
        {...rest}
      />
    </FieldShell>
  );
}

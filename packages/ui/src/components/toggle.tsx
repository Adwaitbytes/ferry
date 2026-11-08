'use client';

import { Switch } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { cn } from '../cn';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Adds "On" / "Off" after the label when the meaning is not obvious (DESIGN 7.3). */
  showState?: boolean | undefined;
  description?: ReactNode | undefined;
  disabled?: boolean | undefined;
  /** Why it is disabled. Shown as text so it is reachable without hover. */
  disabledReason?: string | undefined;
  className?: string | undefined;
}

export function Toggle({ label, checked, onCheckedChange, showState, description, disabled, disabledReason, className }: ToggleProps) {
  const id = useId();
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className={cn('text-body font-medium', disabled ? 'text-text-disabled' : 'text-text-primary')}>
          {label}
          {showState ? <span className="font-normal text-text-secondary">: {checked ? 'On' : 'Off'}</span> : null}
        </label>
        {description ? (
          <p id={`${id}-desc`} className="text-small text-text-tertiary">
            {description}
          </p>
        ) : null}
        {disabled && disabledReason ? <p className="text-small text-text-tertiary">{disabledReason}</p> : null}
      </div>
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled === true}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={cn(
          'group relative mt-0.5 inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 ease-out',
          'before:absolute before:-inset-y-1 before:-inset-x-0 before:content-[""]',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=unchecked]:border-border-control data-[state=unchecked]:bg-surface-3',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Switch.Thumb
          className={cn(
            'block size-3.5 rounded-full transition-transform duration-150 ease-out',
            'data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-accent-fg data-[state=unchecked]:translate-x-px data-[state=unchecked]:bg-text-secondary',
          )}
        />
      </Switch.Root>
    </div>
  );
}

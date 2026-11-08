'use client';

import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { IconButton } from './button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode | undefined;
  children?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  size?: 'sm' | 'md' | undefined;
}

/**
 * Accessible modal (DESIGN 7.15): Radix traps focus, returns it to the trigger, and closes on Esc.
 * The scrim is a solid tint; nothing blurs.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'sm' }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-[ferry-fade-in_240ms_var(--ferry-ease-out)]" />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg bg-surface-1 p-6 shadow-4',
            'data-[state=open]:animate-[ferry-dialog-in_240ms_var(--ferry-ease-out)]',
            size === 'sm' ? 'max-w-[480px]' : 'max-w-[640px]',
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-title font-semibold text-text-primary">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton icon={X} label="Close" size="sm" className="-mr-2 -mt-1" />
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className="text-body text-text-secondary">{description}</RadixDialog.Description>
          ) : null}
          {children}
          {footer ? <div className="mt-2 flex flex-wrap justify-end gap-3">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;

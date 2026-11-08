'use client';

import { motion, useReducedMotion } from 'motion/react';
import { Tabs as RadixTabs } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { cn } from '../cn';
import { duration, ease, instant } from '../motion';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number | undefined;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  children?: ReactNode | undefined;
  className?: string | undefined;
}

/** Underline tabs with a sliding accent indicator (DESIGN 7.4). Never more than 5 tabs. */
export function Tabs<T extends string>({ items, value, onValueChange, label, children, className }: TabsProps<T>) {
  const layoutId = useId();
  const reduce = useReducedMotion();
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => {
        const match = items.find((item) => item.value === next);
        if (match) onValueChange(match.value);
      }}
      className={className}
    >
      <RadixTabs.List aria-label={label} className="flex h-11 items-stretch gap-6 border-b border-border-hairline">
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <RadixTabs.Trigger
              key={item.value}
              value={item.value}
              className={cn(
                'relative inline-flex items-center gap-1.5 text-body font-medium transition-colors duration-150 ease-out focus-visible:outline-offset-[-2px]',
                selected ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {item.label}
              {item.count !== undefined ? <span className="tabular text-text-tertiary">{item.count}</span> : null}
              {selected ? (
                <motion.span
                  layoutId={layoutId}
                  transition={reduce ? instant : { duration: duration.base, ease: ease.inOut }}
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-accent"
                  aria-hidden="true"
                />
              ) : null}
            </RadixTabs.Trigger>
          );
        })}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string | undefined }) {
  return (
    <RadixTabs.Content value={value} className={cn('pt-6', className)}>
      {children}
    </RadixTabs.Content>
  );
}

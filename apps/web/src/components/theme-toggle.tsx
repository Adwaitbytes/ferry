'use client';

import { cn } from '@ferry/ui/cn';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { THEME_COOKIE, type ThemeChoice } from '@/lib/theme';

const options: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'Match system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') {
    delete root.dataset.theme;
    document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  } else {
    root.dataset.theme = choice;
    document.cookie = `${THEME_COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
}

/** System, light or dark. A radio group, so arrow keys move between the three. */
export function ThemeToggle({ initial, className }: { initial: ThemeChoice; className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const select = (value: ThemeChoice) => {
    setChoice(value);
    apply(value);
  };
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('inline-flex h-8 items-center gap-0.5 rounded-full border border-border-hairline bg-surface-1 p-0.5', className)}>
      {options.map(({ value, label, icon: Icon }, index) => {
        const checked = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            onClick={() => select(value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              event.preventDefault();
              const next = options[(index + (event.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
              if (!next) return;
              select(next.value);
              const sibling = event.currentTarget.parentElement?.children[options.indexOf(next)];
              if (sibling instanceof HTMLElement) sibling.focus();
            }}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-full transition-colors duration-150 ease-out',
              checked ? 'bg-surface-3 text-text-primary' : 'text-text-tertiary hover:text-text-primary',
            )}
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

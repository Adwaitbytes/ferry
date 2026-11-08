'use client';

import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../cn';
import { ease } from '../motion';

const formatter = new Intl.NumberFormat('en-US');

export interface CounterProps {
  value: number;
  unit?: string | undefined;
  /** Formats the number. Defaults to grouped integers ("1,208"). */
  format?: (value: number) => string;
  className?: string | undefined;
  unitClassName?: string | undefined;
  /** Set when the number updates during a task the user is watching. */
  live?: boolean | undefined;
}

/**
 * Tabular Geist number that counts from its previous value when real data changes (DESIGN 7.19).
 * Under reduced motion it jumps to the final number.
 */
export function Counter({ value, unit, format = (n) => formatter.format(Math.round(n)), className, unitClassName, live }: CounterProps) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduce || from === value) {
      setShown(value);
      return;
    }
    const controls = animate(from, value, { duration: 0.6, ease: ease.out, onUpdate: setShown });
    return () => controls.stop();
  }, [value, reduce]);

  return (
    <span className={cn('tabular font-sans', className)} aria-live={live ? 'polite' : undefined}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
      {unit ? <span className={cn('font-normal text-text-secondary', unitClassName)}> {unit}</span> : null}
    </span>
  );
}

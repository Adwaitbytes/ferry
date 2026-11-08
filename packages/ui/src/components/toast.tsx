'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { duration, ease } from '../motion';
import { Button } from './button';

export type ToastTone = 'success' | 'info' | 'error';

export interface ToastInput {
  message: string;
  tone?: ToastTone | undefined;
  action?: { label: string; onAction: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

const MAX_STACK = 3;
const toneIcon: Record<ToastTone, LucideIcon> = { success: CircleCheck, info: Info, error: CircleAlert };
const toneColor: Record<ToastTone, string> = { success: 'text-success', info: 'text-info', error: 'text-danger' };

/** Bottom-right toasts (DESIGN 7.10): 5s, 8s with an action, errors stay until closed. Max 3. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { ...toast, id }].slice(-MAX_STACK));
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-32px)] max-w-[360px] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <ToastView key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const reduce = useReducedMotion();
  const tone = toast.tone ?? 'success';
  const [paused, setPaused] = useState(false);
  const Icon = toneIcon[tone];

  useEffect(() => {
    if (tone === 'error' || paused) return;
    const timer = setTimeout(onDismiss, toast.action ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [tone, paused, toast.action, onDismiss]);

  return (
    <motion.div
      layout={!reduce}
      role={tone === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: reduce ? 0 : 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } }}
      exit={{ opacity: 0, transition: { duration: duration.fast, ease: ease.in } }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-start gap-3 rounded-md border border-border-hairline bg-surface-2 py-3 pl-4 pr-2 shadow-3"
    >
      <Icon size={16} strokeWidth={1.75} className={`mt-[3px] shrink-0 ${toneColor[tone]}`} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-body text-text-primary">{toast.message}</p>
      {toast.action ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            toast.action?.onAction();
            onDismiss();
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <button
        type="button"
        aria-label="Close notification"
        onClick={onDismiss}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
      >
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </motion.div>
  );
}

import { ContentRequest, PanelRequest, WebAppRequest } from '@ferry/core';
import type { SenderClass } from './senders';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The core schemas are non-strict zod objects, which silently strip unknown keys. The worker must
 * reject them instead (THREAT_MODEL section 4, RT-36), so every key in the input must survive
 * parsing. Records such as `settings.set.patch` keep all their keys and pass naturally.
 */
export function hasUnknownKeys(input: unknown, parsed: unknown): boolean {
  if (Array.isArray(input)) {
    if (!Array.isArray(parsed) || parsed.length !== input.length) return true;
    return input.some((item, i) => hasUnknownKeys(item, parsed[i]));
  }
  if (typeof input === 'object' && input !== null) {
    if (!isPlainObject(input) || !isPlainObject(parsed)) return true;
    for (const key of Object.keys(input)) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) return true;
      if (hasUnknownKeys(input[key], parsed[key])) return true;
    }
  }
  return false;
}

export type ParsedRequest =
  | { origin: 'content'; message: ContentRequest }
  | { origin: 'extension_page'; message: PanelRequest }
  | { origin: 'web_app'; message: WebAppRequest };

/** The schema is chosen from the sender class, never from the payload (DECISIONS 2026-11-08). */
export function parseFor(
  sender: Exclude<SenderClass, { kind: 'forbidden' }>,
  raw: unknown,
): ParsedRequest | null {
  if (!isPlainObject(raw)) return null;
  switch (sender.kind) {
    case 'content': {
      const r = ContentRequest.safeParse(raw);
      return r.success && !hasUnknownKeys(raw, r.data)
        ? { origin: 'content', message: r.data }
        : null;
    }
    case 'extension_page': {
      const r = PanelRequest.safeParse(raw);
      return r.success && !hasUnknownKeys(raw, r.data)
        ? { origin: 'extension_page', message: r.data }
        : null;
    }
    case 'web_app': {
      const r = WebAppRequest.safeParse(raw);
      return r.success && !hasUnknownKeys(raw, r.data)
        ? { origin: 'web_app', message: r.data }
        : null;
    }
  }
}

const TYPES_BY_CLASS = {
  content: new Set<string>(ContentRequest.options.map((o) => o.shape.type.value)),
  extension_page: new Set<string>(PanelRequest.options.map((o) => o.shape.type.value)),
  web_app: new Set<string>(WebAppRequest.options.map((o) => o.shape.type.value)),
} as const;

/**
 * A malformed message of a type this sender may send is `invalid_message`; a type that only another
 * sender class may send is a privilege attempt and gets `forbidden_sender` (X-MSG-2).
 */
export function isOtherClassType(
  sender: Exclude<SenderClass, { kind: 'forbidden' }>,
  raw: unknown,
): boolean {
  if (!isPlainObject(raw) || typeof raw.type !== 'string') return false;
  const type = raw.type;
  if (TYPES_BY_CLASS[sender.kind].has(type)) return false;
  return Object.values(TYPES_BY_CLASS).some((set) => set.has(type));
}

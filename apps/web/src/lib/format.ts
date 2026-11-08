import type { FactType } from '@ferry/core';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

/** "12 Oct 2026". UTC so the server and the browser render the same string. */
export function formatDate(value: string | number | Date): string {
  return dateFmt.format(new Date(value));
}

/** "12 Oct 2026, 21:14 UTC". */
export function formatDateTime(value: string | number | Date): string {
  const d = new Date(value);
  return `${dateFmt.format(d)}, ${timeFmt.format(d)} UTC`;
}

export function formatMonth(value: string | number | Date): string {
  return monthFmt.format(new Date(value));
}

export function formatTime(value: string | number | Date): string {
  return `${timeFmt.format(new Date(value))} UTC`;
}

export const FACT_TYPE_LABEL: Record<FactType, string> = {
  identity: 'Identity',
  preference: 'Preference',
  dislike: 'Dislike',
  person: 'Person',
  project: 'Project',
  goal: 'Goal',
  routine: 'Routine',
  decision: 'Decision',
  skill: 'Skill',
  constraint: 'Constraint',
  lesson: 'Lesson',
};

export const FACT_TYPE_PLURAL: Record<FactType, string> = {
  identity: 'identity facts',
  preference: 'preferences',
  dislike: 'dislikes',
  person: 'people',
  project: 'projects',
  goal: 'goals',
  routine: 'routines',
  decision: 'decisions',
  skill: 'skills',
  constraint: 'constraints',
  lesson: 'lessons',
};

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** Walrus Mainnet epochs are 14 days. Used only for the human hint next to a real epoch number. */
const EPOCH_MS = 14 * 24 * 60 * 60 * 1000;

export function aboutEpochDate(endEpoch: number, currentEpoch: number, now: number = Date.now()): string {
  return `about ${formatDate(now + (endEpoch - currentEpoch) * EPOCH_MS)}`;
}

export function daysSince(iso: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

/** "Chrome", "Edge", "Brave" or "Browser", for the delegate key label. */
export function browserName(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/OPR\//.test(userAgent)) return 'Opera';
  if (/Chrome\//.test(userAgent)) return 'Chrome';
  return 'Browser';
}

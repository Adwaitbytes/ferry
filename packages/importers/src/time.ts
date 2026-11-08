/** Anything outside 2000..2200 is a placeholder (0) or garbage, not a real message time. */
const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2200, 0, 1);

function plausible(ms: number): number | null {
  return Number.isFinite(ms) && ms >= MIN_MS && ms < MAX_MS ? ms : null;
}

/** ChatGPT stores float epoch seconds, sometimes 0 or null. */
export function epochSecondsToMs(value: unknown): number | null {
  return typeof value === 'number' ? plausible(Math.round(value * 1000)) : null;
}

/** Strict-enough ISO 8601 check before Date.parse, which otherwise accepts many loose forms. */
const ISO_START = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

export function isoToMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 40 || !ISO_START.test(value) || !ISO_ZONE.test(value)) return null;
  return plausible(Date.parse(value));
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Offsets in minutes for the abbreviations Google prints in Takeout HTML. */
const ZONES: Readonly<Record<string, number>> = {
  UTC: 0, GMT: 0, Z: 0, WET: 0, BST: 60, IST: 330, CET: 60, CEST: 120, EET: 120, EEST: 180, MSK: 180,
  EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420, AKST: -540, AKDT: -480,
  HST: -600, JST: 540, KST: 540, AEST: 600, AEDT: 660, ACST: 570, AWST: 480, NZST: 720, NZDT: 780, SGT: 480,
};

function lookup(table: Readonly<Record<string, number>>, key: string): number | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function zoneOffset(zone: string): number | null {
  const named = lookup(ZONES, zone.toUpperCase());
  if (named !== undefined) return named;
  const m = /^(?:GMT|UTC)([+-])(\d{1,2})(:\d\d|)$/i.exec(zone);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number((m[3] ?? '').slice(1));
  return m[1] === '-' ? -minutes : minutes;
}

const US_STYLE = /^([A-Za-z]{3,4})\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2})\s?([AaPp][Mm])\s+(\S+)$/;
const INTL_STYLE = /^(\d{1,2}) ([A-Za-z]{3,4})\.? (\d{4}),? (\d{1,2}):(\d{2}):(\d{2})\s+(\S+)$/;

/**
 * Parses the timestamp line of a Google My Activity HTML entry, e.g. "Jun 7, 2025, 2:52:31 PM UTC"
 * or "7 Jun 2025, 14:52:31 CEST". Returns null for formats we do not recognize.
 */
export function parseTakeoutDate(raw: string): number | null {
  const text = raw.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  let year: number, month: number | undefined, day: number, hour: number, minute: number, second: number, zone: string;
  const us = US_STYLE.exec(text);
  const intl = us ? null : INTL_STYLE.exec(text);
  if (us) {
    month = lookup(MONTHS, (us[1] ?? '').toLowerCase());
    day = Number(us[2]);
    year = Number(us[3]);
    hour = Number(us[4]) % 12;
    if ((us[7] ?? '').toLowerCase() === 'pm') hour += 12;
    minute = Number(us[5]);
    second = Number(us[6]);
    zone = us[8] ?? '';
  } else if (intl) {
    day = Number(intl[1]);
    month = lookup(MONTHS, (intl[2] ?? '').toLowerCase());
    year = Number(intl[3]);
    hour = Number(intl[4]);
    minute = Number(intl[5]);
    second = Number(intl[6]);
    zone = intl[7] ?? '';
  } else {
    return null;
  }
  if (month === undefined) return null;
  const offset = zoneOffset(zone);
  if (offset === null) return null;
  return plausible(Date.UTC(year, month, day, hour, minute, second) - offset * 60_000);
}

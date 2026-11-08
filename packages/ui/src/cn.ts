type ClassValue = string | false | null | undefined | 0;

/** Joins class names, skipping falsy values. Ferry has no conflicting utilities to merge. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}

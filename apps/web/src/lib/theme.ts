export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_COOKIE = 'ferry-theme';

export function parseTheme(value: string | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

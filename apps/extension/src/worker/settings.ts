import { ALWAYS_BLOCKED, SENSITIVE_CATEGORIES, Site, type SensitiveCategory } from '@ferry/core';
import { z } from 'zod';

import type { StorageArea } from './ports';

export const SETTINGS_KEY = 'ferry.settings';

const OPTIONAL_SENSITIVE = SENSITIVE_CATEGORIES.filter((c) => !ALWAYS_BLOCKED.includes(c));
const OptionalSensitive = z.enum(OPTIONAL_SENSITIVE as [SensitiveCategory, ...SensitiveCategory[]]);

export const SiteSettings = z
  .object({
    /** "Offer to save" */
    capture: z.boolean(),
    /** "Offer context" */
    inject: z.boolean(),
    /** "Save automatically": off by default, and never applies to sensitive or flagged facts. */
    auto: z.boolean(),
    /** "Always attach on new chats" */
    alwaysAttach: z.boolean(),
  })
  .strict();
export type SiteSettings = z.infer<typeof SiteSettings>;

export const Settings = z
  .object({
    sites: z.object({ chatgpt: SiteSettings, claude: SiteSettings, gemini: SiteSettings }).strict(),
    /** Optional categories the user chose to allow in imports. Always-blocked ones can never appear. */
    sensitiveAllowed: z.array(OptionalSensitive).max(OPTIONAL_SENSITIVE.length),
    autoLockMinutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
  })
  .strict();
export type Settings = z.infer<typeof Settings>;

const siteDefaults: SiteSettings = {
  capture: true,
  inject: true,
  auto: false,
  alwaysAttach: false,
};

export const DEFAULT_SETTINGS: Settings = {
  sites: { chatgpt: { ...siteDefaults }, claude: { ...siteDefaults }, gemini: { ...siteDefaults } },
  sensitiveAllowed: [],
  autoLockMinutes: 30,
};

/** A patch may touch any subset of fields; nested site objects are merged, not replaced. */
export const SettingsPatch = z
  .object({
    sites: z
      .object(Object.fromEntries(Site.options.map((s) => [s, SiteSettings.partial()])))
      .partial()
      .strict(),
    sensitiveAllowed: Settings.shape.sensitiveAllowed,
    autoLockMinutes: Settings.shape.autoLockMinutes,
  })
  .partial()
  .strict();

export class SettingsStore {
  private cache: Settings | null = null;

  constructor(private readonly area: StorageArea) {}

  async get(): Promise<Settings> {
    if (this.cache !== null) return this.cache;
    const parsed = Settings.safeParse(await this.area.get(SETTINGS_KEY));
    this.cache = parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
    return this.cache;
  }

  /** Returns null when the patch is invalid, so the caller can answer `invalid_message`. */
  async apply(patch: unknown): Promise<Settings | null> {
    const parsed = SettingsPatch.safeParse(patch);
    if (!parsed.success) return null;
    const current = await this.get();
    const sites = { ...current.sites };
    const patchSites = (parsed.data.sites ?? {}) as Partial<Record<Site, Partial<SiteSettings>>>;
    for (const site of Site.options) {
      const delta = patchSites[site];
      if (delta !== undefined) sites[site] = { ...sites[site], ...delta };
    }
    const next = Settings.parse({
      sites,
      sensitiveAllowed: [...new Set(parsed.data.sensitiveAllowed ?? current.sensitiveAllowed)],
      autoLockMinutes: parsed.data.autoLockMinutes ?? current.autoLockMinutes,
    });
    await this.area.set(SETTINGS_KEY, next);
    this.cache = next;
    return next;
  }

  reset(): void {
    this.cache = null;
  }
}

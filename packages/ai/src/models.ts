import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { DeskProvider } from '@ferry/core';

/** Defaults verified against the installed provider model id unions; override per deploy via env. */
const DEFAULTS = {
  utility: 'claude-haiku-5-5',
  claude: 'claude-sonnet-5-5',
  gpt: 'gpt-6.1-terra',
  gemini: 'gemini-flash-latest',
} as const;

export type Env = Readonly<Record<string, string | undefined>>;

export class ProviderUnavailableError extends Error {
  constructor(readonly provider: DeskProvider | 'utility') {
    super(`provider ${provider} is not configured`);
  }
}

/** The fast model used for Distill, Capture and Judge. Anthropic is the required key (PRD 13). */
export function utilityModel(env: Env): LanguageModel {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderUnavailableError('utility');
  return createAnthropic({ apiKey })(env.FERRY_UTILITY_MODEL ?? DEFAULTS.utility);
}

export function deskModel(provider: DeskProvider, env: Env): LanguageModel {
  switch (provider) {
    case 'claude': {
      if (!env.ANTHROPIC_API_KEY) throw new ProviderUnavailableError(provider);
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(env.FERRY_CLAUDE_MODEL ?? DEFAULTS.claude);
    }
    case 'gpt': {
      if (!env.OPENAI_API_KEY) throw new ProviderUnavailableError(provider);
      return createOpenAI({ apiKey: env.OPENAI_API_KEY })(env.FERRY_GPT_MODEL ?? DEFAULTS.gpt);
    }
    case 'gemini': {
      if (!env.GOOGLE_GENERATIVE_AI_API_KEY) throw new ProviderUnavailableError(provider);
      return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(
        env.FERRY_GEMINI_MODEL ?? DEFAULTS.gemini,
      );
    }
  }
}

/** Which Desk providers this deployment can actually serve, so the UI never offers a dead option. */
export function availableDeskProviders(env: Env): DeskProvider[] {
  const out: DeskProvider[] = [];
  if (env.ANTHROPIC_API_KEY) out.push('claude');
  if (env.OPENAI_API_KEY) out.push('gpt');
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) out.push('gemini');
  return out;
}

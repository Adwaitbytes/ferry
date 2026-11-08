import { generateText, type LanguageModel } from 'ai';

export interface LlmJsonRequest {
  system: string;
  user: string;
  schemaName: string;
  maxTokens: number;
}
export type LlmJson = (req: LlmJsonRequest) => Promise<unknown>;

export class LlmOutputError extends Error {}

/**
 * Pulls the first top-level JSON object or array out of model text. Callers validate the result
 * with zod; this only has to be tolerant of prose or code fences around the JSON.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new LlmOutputError('no JSON in model output');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  if (end <= start) throw new LlmOutputError('unterminated JSON in model output');
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    throw new LlmOutputError('invalid JSON in model output');
  }
}

/** Adapts an AI SDK model to the provider-agnostic interface `@ferry/distill` expects. */
export function createLlmJson(model: LanguageModel, opts: { timeoutMs?: number } = {}): LlmJson {
  return async ({ system, user, schemaName, maxTokens }) => {
    const { text } = await generateText({
      model,
      system: `${system}\n\nRespond with a single JSON value matching the ${schemaName} schema and nothing else.`,
      prompt: user,
      maxOutputTokens: maxTokens,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    });
    return extractJson(text);
  };
}

export type LlmSchemaName = 'ferry_distill' | 'ferry_judge';

export interface LlmJsonRequest {
  system: string;
  user: string;
  schemaName: LlmSchemaName;
  /** JSON Schema of the expected output, for providers that support structured output. */
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}

/**
 * Provider-agnostic LLM call that returns parsed JSON. Adapters (server key or BYOK) live with
 * the caller, so this package never imports an SDK. The return value is untrusted.
 */
export type LlmJson = (req: LlmJsonRequest) => Promise<unknown>;

export type DistillErrorCode = 'INVALID_REQUEST' | 'LLM_FAILED';

/**
 * Carries only a code. Provider errors can echo the prompt, which is the user's chat text,
 * so the original error is deliberately not attached as `cause` (X-LOG-1).
 */
export class DistillError extends Error {
  readonly code: DistillErrorCode;
  constructor(code: DistillErrorCode) {
    super(code);
    this.name = 'DistillError';
    this.code = code;
  }
}

/**
 * Serializes untrusted text as a JSON string with angle brackets escaped, so chunk content can
 * neither close the JSON value nor forge the surrounding `<chunks>` delimiter tags.
 */
export function asDataLiteral(value: unknown): string {
  return JSON.stringify(value, null, 1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

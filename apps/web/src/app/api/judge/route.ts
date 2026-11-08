import { createLlmJson, ProviderUnavailableError, utilityModel } from '@ferry/ai';
import { JudgeRequest } from '@ferry/core';
import { judgeConflicts } from '@ferry/distill';
import { clientIp, json, log, readCapped, takeToken } from '@/server/guard';

/** Classifies a new fact against its neighbors: same, refines, contradicts or unrelated (PRD F5). */
export async function POST(req: Request): Promise<Response> {
  const started = Date.now();
  const done = (status: number, body: unknown, code?: string) => {
    log({ route: 'judge', status, durationMs: Date.now() - started, ...(code ? { code } : {}) });
    return json(status, body);
  };
  if (!takeToken(`judge:${clientIp(req)}`, 60)) return done(429, { error: 'RATE_LIMITED' }, 'RATE_LIMITED');
  const raw = await readCapped(req, 32 * 1024);
  if (raw === null) return done(413, { error: 'BODY_TOO_LARGE' }, 'BODY_TOO_LARGE');
  let parsed;
  try {
    parsed = JudgeRequest.safeParse(JSON.parse(raw));
  } catch {
    return done(400, { error: 'INVALID_REQUEST' }, 'INVALID_REQUEST');
  }
  if (!parsed.success) return done(400, { error: 'INVALID_REQUEST' }, 'INVALID_REQUEST');
  if (parsed.data.neighbors.length === 0) return done(200, { verdicts: [] });
  try {
    const llm = createLlmJson(utilityModel(process.env));
    return done(200, await judgeConflicts(parsed.data.fact, parsed.data.neighbors, llm));
  } catch (err) {
    if (err instanceof ProviderUnavailableError) return done(503, { error: 'LLM_UNAVAILABLE' }, 'LLM_UNAVAILABLE');
    return done(502, { error: 'LLM_FAILED' }, 'LLM_FAILED');
  }
}

import { createLlmJson, ProviderUnavailableError, utilityModel } from '@ferry/ai';
import { handleDistillRequest } from '@ferry/distill';
import { clientIp, json, log, takeToken } from '@/server/guard';

/** Stateless fact extraction for Rescue and Capture. Bodies are never logged (PRD 6.2). */
export async function POST(req: Request): Promise<Response> {
  if (!takeToken(`distill:${clientIp(req)}`, 30)) return json(429, { error: 'RATE_LIMITED' }, { 'retry-after': '10' });
  let llm;
  try {
    llm = createLlmJson(utilityModel(process.env));
  } catch (err) {
    if (err instanceof ProviderUnavailableError) return json(503, { error: 'LLM_UNAVAILABLE' });
    throw err;
  }
  const res = await handleDistillRequest(await req.text(), { llm, log, requestId: crypto.randomUUID() });
  return json(res.status, res.body);
}

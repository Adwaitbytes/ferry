import { availableDeskProviders, chooseProvider, deskModel, deskViaInteractions, streamDesk, usesInteractionsKey } from '@ferry/ai';
import { DeskRequest } from '@ferry/core';
import { clientIp, json, log, readCapped, takeToken } from '@/server/guard';

/**
 * Ferry Desk chat proxy for the Blackout Drill. Stateless: the client sends the thread and the
 * recalled facts each turn; nothing is stored and bodies are never logged.
 */
export async function POST(req: Request): Promise<Response> {
  const started = Date.now();
  const fail = (status: number, code: string) => {
    log({ route: 'desk', status, durationMs: Date.now() - started, code });
    return json(status, { error: code });
  };
  if (!takeToken(`desk:${clientIp(req)}`, 20)) return fail(429, 'RATE_LIMITED');
  const raw = await readCapped(req);
  if (raw === null) return fail(413, 'BODY_TOO_LARGE');
  let parsed;
  try {
    parsed = DeskRequest.safeParse(JSON.parse(raw));
  } catch {
    return fail(400, 'INVALID_REQUEST');
  }
  if (!parsed.success) return fail(400, 'INVALID_REQUEST');
  const provider = chooseProvider(parsed.data, availableDeskProviders(process.env));
  if (!provider) return fail(503, 'NO_PROVIDER');
  log({ route: 'desk', status: 200, durationMs: Date.now() - started, code: provider });
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (provider === 'gemini' && googleKey && usesInteractionsKey(googleKey)) {
    try {
      return await deskViaInteractions(parsed.data, { apiKey: googleKey, served: provider, signal: req.signal });
    } catch {
      return fail(502, 'PROVIDER_FAILED');
    }
  }
  return streamDesk(parsed.data, deskModel(provider, process.env), provider, req.signal);
}

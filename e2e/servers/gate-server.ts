/*
 * Runs the real Ferry Gate app (apps/gate/src/app.ts) over HTTP, wired through the Gate's own test
 * rig (apps/gate/test/harness.ts): Postgres is PGlite in memory, the Tatum verifier reads a
 * normalized transaction the rig sets, and public recall returns the rig's fixed fact. A separate
 * control port plays the paying agent (TripScout): it turns a 402 challenge into a signed MPP
 * credential with the real suimpp client and marks the payment as settled on the mock chain.
 * CI only: nothing here touches Sui, Tatum or Neon.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { credentialFor, harness, paidTx, type Harness } from '../../apps/gate/test/harness';
import { GATE_CONTROL_PORT, GATE_PORT, WEB_ORIGIN } from '../support/protocol';

// Bound to the e2e web origin, so CORS and the SIWS domain match the web app under test.
const fresh = () => harness({ webOrigin: WEB_ORIGIN });
let current: Harness = await fresh();

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers).end(Buffer.from(await response.arrayBuffer()));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

createServer((req, res) => {
  void (async () => {
    const body = await readBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
    const request = new Request(`http://127.0.0.1:${GATE_PORT}${req.url ?? '/'}`, {
      method: req.method ?? 'GET',
      headers,
      ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
    });
    await send(res, await current.app.fetch(request));
  })().catch(() => json(res, 500, { error: 'e2e_gate_server_failed' }));
}).listen(GATE_PORT, '127.0.0.1');

interface ChallengeCopy {
  status: number;
  headers: Record<string, string>;
  body: string;
}

createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${GATE_CONTROL_PORT}`);
    if (req.method === 'POST' && url.pathname === '/reset') {
      current = await fresh();
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/pay') {
      const challenge = JSON.parse((await readBody(req)).toString('utf8')) as ChallengeCopy;
      const authorization = await credentialFor(new Response(challenge.body, { status: challenge.status, headers: challenge.headers }));
      current.chain.tx = paidTx();
      json(res, 200, { authorization });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/state') {
      json(res, 200, { recallCalls: current.recallCalls.length, logs: current.logs });
      return;
    }
    if (url.pathname === '/health') {
      json(res, 200, { ok: true });
      return;
    }
    json(res, 404, { error: 'not_found' });
  })().catch(() => json(res, 500, { error: 'e2e_gate_control_failed' }));
}).listen(GATE_CONTROL_PORT, '127.0.0.1');

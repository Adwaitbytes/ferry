/**
 * X-LOG-1: the only logger in the Gate. Fields are allowlisted and typed, so a query, a fact or
 * a request body cannot reach a log line even by mistake.
 */
export interface GateLogEvent {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  cardId?: string;
  receiptId?: string;
  code?: string;
}

export type GateLog = (event: GateLogEvent) => void;

const SAFE = /^[A-Za-z0-9_:/.-]{1,80}$/;

export function createGateLogger(sink: (line: string) => void): GateLog {
  return (event) => {
    const line: Record<string, string | number> = {
      route: SAFE.test(event.route) ? event.route : '[redacted]',
      method: SAFE.test(event.method) ? event.method : '[redacted]',
      status: event.status,
      durationMs: Math.round(event.durationMs),
    };
    for (const key of ['cardId', 'receiptId', 'code'] as const) {
      const value = event[key];
      if (value !== undefined) line[key] = SAFE.test(value) ? value : '[redacted]';
    }
    sink(JSON.stringify(line));
  };
}

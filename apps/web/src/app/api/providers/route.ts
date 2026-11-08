import { availableDeskProviders } from '@ferry/ai';
import { json } from '@/server/guard';

/** Lets Desk show only providers this deployment can serve. Names only, never keys. */
export function GET(): Response {
  return json(200, { providers: availableDeskProviders(process.env) });
}

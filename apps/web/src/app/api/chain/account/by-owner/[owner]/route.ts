import type { NextRequest } from 'next/server';
import { chainRoute, preflight } from '../../../_lib/http';
import { ObjectIdParam } from '../../../_lib/params';

export const runtime = 'nodejs';

/** The owner's MemWalAccount via the registry accounts table, as a core AccountView (F1 detection). */
export async function GET(request: NextRequest, context: { params: Promise<{ owner: string }> }) {
  return chainRoute(request, 'account.by-owner', async (chain) =>
    chain.readAccountByOwner(ObjectIdParam.parse((await context.params).owner)),
  );
}

export const OPTIONS = preflight;

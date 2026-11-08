import type { NextRequest } from 'next/server';
import { chainRoute, preflight } from '../../_lib/http';
import { ObjectIdParam } from '../../_lib/params';

export const runtime = 'nodejs';

/** MemWalAccount by object id, as a core AccountView (F7 Devices, F1 pairing check). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return chainRoute(request, 'account', async (chain) => chain.readAccount(ObjectIdParam.parse((await context.params).id)));
}

export const OPTIONS = preflight;

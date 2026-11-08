import type { NextRequest } from 'next/server';
import { chainRoute, preflight } from '../_lib/http';

export const runtime = 'nodejs';

/** Tatum credit meter for the Proofs page: calls and estimated credits per method, this instance. */
export async function GET(request: NextRequest) {
  return chainRoute(request, 'meter', async (chain) => chain.getMeter());
}

export const OPTIONS = preflight;

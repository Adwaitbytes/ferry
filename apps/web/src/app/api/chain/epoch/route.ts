import type { NextRequest } from 'next/server';
import { chainRoute, preflight } from '../_lib/http';

export const runtime = 'nodejs';

/** Current Sui and Walrus epochs (both cached 60 s server-side). */
export async function GET(request: NextRequest) {
  return chainRoute(request, 'epoch', (chain) => chain.currentEpoch());
}

export const OPTIONS = preflight;

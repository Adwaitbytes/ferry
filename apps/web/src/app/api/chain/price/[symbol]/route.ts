import type { NextRequest } from 'next/server';
import { chainRoute, preflight } from '../../_lib/http';
import { SymbolParam } from '../../_lib/params';

export const runtime = 'nodejs';

/** USD price from Tatum market data, cached 60 s (F8 earnings in fiat). */
export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  return chainRoute(request, 'price', async (chain) => chain.getUsdPrice(SymbolParam.parse((await context.params).symbol)));
}

export const OPTIONS = preflight;

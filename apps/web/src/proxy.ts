import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request nonce CSP (PRD 6.2). Scripts and style elements need the nonce; style attributes are
 * allowed because React and Motion write them, and attributes cannot execute code. Trusted Types
 * is enforced in production so any accidental HTML sink throws instead of rendering.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const aggregator = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ?? 'https://aggregator.walrus-mainnet.walrus.space';
  // Wallet connection talks gRPC-Web to the public fullnode and reads Slush wallet metadata; earnings come from Gate.
  const gate = process.env.NEXT_PUBLIC_GATE_URL ? new URL(process.env.NEXT_PUBLIC_GATE_URL).origin : '';
  const walletHosts = 'https://fullnode.mainnet.sui.io https://api.slush.app';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${aggregator} ${walletHosts}${gate ? ` ${gate}` : ''}${isDev ? ' ws:' : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["require-trusted-types-for 'script'", 'upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|v1|_next/static|_next/image|favicon.ico|fonts).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The e2e suite builds with test-only public env (a fake extension id) into its own directory so
  // it never overwrites the real build.
  distDir: process.env.FERRY_NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@ferry/core', '@ferry/chain', '@ferry/ai', '@ferry/distill', '@ferry/ui', '@ferry/importers', '@ferry/pay'],
  // Workspace packages are TypeScript source with NodeNext-style `.js` specifiers. Turbopack in
  // Next 16.4 does not map those to `.ts`, so builds use webpack with an extension alias.
  webpack(webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    webpackConfig.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return webpackConfig;
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;

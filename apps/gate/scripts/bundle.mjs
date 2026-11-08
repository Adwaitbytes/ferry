// Bundles the Gate and its workspace packages (which ship TypeScript sources) into one ESM file,
// because the Vercel Node runtime does not compile or trace workspace .ts sources at request time.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/vercel.ts'],
  outfile: 'api/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none',
  // CJS dependencies inside an ESM bundle need a real require.
  banner: { js: "import { createRequire as __ferryCreateRequire } from 'node:module'; const require = __ferryCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});

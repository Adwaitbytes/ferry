// Bundles the Gate and its workspace packages (which ship TypeScript sources) into one ESM file
// and emits it through Vercel's Build Output API v3, because the Vercel Node runtime neither
// compiles nor traces workspace .ts sources and only discovers api/ functions before the build.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const out = '.vercel/output';
const fn = `${out}/functions/index.func`;
await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });

await build({
  entryPoints: ['src/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'none',
  // CJS dependencies inside an ESM bundle need a real require.
  banner: { js: "import { createRequire as __ferryCreateRequire } from 'node:module'; const require = __ferryCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});

await writeFile(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs24.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true }),
);
await writeFile(`${fn}/package.json`, JSON.stringify({ type: 'module' }));
await writeFile(`${out}/config.json`, JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index' }] }));

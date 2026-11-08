import { defineConfig } from 'tsup';

// Vercel deploys src/index.ts directly; this bundle proves the entry and every workspace import
// resolve and compile for the Node runtime, so a broken Gate fails `pnpm build`, not the deploy.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: false,
  treeshake: true,
  noExternal: [/^@ferry\//],
});

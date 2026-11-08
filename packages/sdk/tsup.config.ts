import { defineConfig } from 'tsup';

// Workspace packages ship TypeScript source and are private, so they are bundled in; published
// dependencies stay external so consumers dedupe them (one mppx, one @mysten/sui).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  noExternal: [/^@ferry\//],
  external: ['@mysten/sui', '@suimpp/mpp', 'mppx', 'zod'],
});

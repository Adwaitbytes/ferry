import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000, coverage: { include: ['src/**/*.ts'], exclude: ['src/index.ts'] } },
});

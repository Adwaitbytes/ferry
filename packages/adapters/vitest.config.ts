import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: { include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/testing/**'], thresholds: { lines: 85, branches: 85, functions: 85, statements: 85 } },
  },
});

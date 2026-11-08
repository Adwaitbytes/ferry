import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __FERRY_API_ORIGIN__: JSON.stringify('https://ferry.example'),
    __FERRY_WEB_ORIGIN__: JSON.stringify('https://ferry.example'),
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
});

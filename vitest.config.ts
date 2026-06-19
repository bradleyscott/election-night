import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
    setupFiles: ['packages/dashboard/src/test/setup.ts'],
  },
});

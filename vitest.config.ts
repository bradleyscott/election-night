import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'packages/*/server/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
    setupFiles: ['packages/dashboard/src/test/setup.ts'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Server-side tests live next to the server code they cover, so they are
    // typechecked by tsconfig.server.json (which has node types) rather than by
    // the browser-facing src tsconfig.
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'packages/dashboard/server/**/*.test.ts',
    ],
    setupFiles: ['packages/dashboard/src/test/setup.ts'],
  },
});

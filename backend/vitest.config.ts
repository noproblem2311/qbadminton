import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test file spins up its own in-memory PGlite database.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

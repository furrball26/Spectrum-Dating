import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure Node code — no jsdom needed.
    environment: 'node',
    include: ['test/**/*.test.js'],
    // These tests exercise fast in-memory / tmp-file logic only.
    testTimeout: 15000,
  },
});

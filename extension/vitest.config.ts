import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // Wires `wxt/browser` to an in-memory fake browser (storage, tabs, alarms, ...).
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    // Facebook renders times in the viewer's zone; pin it for deterministic parsing.
    env: { TZ: 'Asia/Ho_Chi_Minh' },
  },
});

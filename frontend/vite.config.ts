import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:3000';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // Same-origin API in development too, mirroring the nginx routing in production.
      proxy: {
        '/api': proxyTarget,
        '/health': proxyTarget,
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
    },
  };
});

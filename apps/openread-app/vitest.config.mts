import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Vitest's default include is '**/*.{test,spec}.{js,ts,jsx,tsx}', which
    // greedily picks up Playwright specs under e2e/**. Those specs import
    // Playwright's `test`/`expect` (not vitest's), so letting vitest load
    // them produces "test.describe() was called in the wrong context"
    // failures at transform time. Exclude the whole e2e tree here — the
    // Playwright matrix in CI (and local `playwright test`) owns it.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'e2e/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
});

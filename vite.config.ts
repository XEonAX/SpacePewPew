import { defineConfig } from 'vitest/config';

/**
 * GitHub Pages serves project sites from `/<repo>/`, so the build needs a
 * matching base. The Pages workflow sets GITHUB_PAGES_BASE; local dev and
 * normal builds stay at the root.
 */
const pagesBase = process.env.GITHUB_PAGES_BASE;

export default defineConfig({
  base: pagesBase ?? '/',
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});

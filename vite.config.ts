import { defineConfig } from 'vitest/config';

// The site is served from https://huang-frederic.github.io/S.I.L.K/, so every
// asset URL must be prefixed with the repository name.
export default defineConfig({
  base: '/S.I.L.K/',
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});

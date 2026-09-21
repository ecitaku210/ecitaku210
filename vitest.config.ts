import { defineConfig } from 'vitest/config'

/**
 * Test config lives apart from `vite.config.ts` on purpose.
 *
 * Vitest 3 removed the `test` key from Vite's own `defineConfig` types, so a
 * single file would have to import `defineConfig` from `vitest/config` and
 * drag the test runner into the production build's config. Splitting them
 * keeps the build config free of test concerns.
 *
 * It also costs nothing: every test here covers `src/domain`, which is plain
 * TypeScript with no JSX and no browser APIs, so the React plugin and the PWA
 * plugin are pure overhead in a test run. Vitest uses this file INSTEAD of
 * vite.config.ts, not in addition to it.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

import { defineConfig } from 'vitest/config'

/**
 * Live evaluation against the TypeSafe API. Run only through
 * `pnpm eval:jev:live`; `pnpm test` never includes these files.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.live.ts'],
    testTimeout: 120_000,
  },
})

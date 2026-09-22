import viteReact from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Renders every story and runs its play function in headless Chromium.
 * Run only through `pnpm test-storybook`; `pnpm test` never includes it.
 * Like `.storybook/vite.config.ts`, it loads only the React plugin.
 */
export default defineConfig({
  plugins: [viteReact()],
  test: {
    include: ['.storybook/stories.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})

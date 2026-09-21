import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  core: {
    disableTelemetry: true,
  },
  stories: ['../src/**/*.stories.tsx'],
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: {
        // The app config loads the TanStack Start plugin, which compiles
        // server functions and routes. Stories render components only.
        viteConfigPath: '.storybook/vite.config.ts',
      },
    },
  },
}

export default config

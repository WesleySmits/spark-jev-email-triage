import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [tanstackStart(), nitro({ preset: 'node-server' }), viteReact()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})

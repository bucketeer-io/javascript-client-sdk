import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['test/globalSetup.ts'],
    environment: 'happy-dom'
  },
})

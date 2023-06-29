import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['test/setup.browser.ts'],
    environment: 'happy-dom',
    browser: {
      provider: 'webdriverio',
      name: 'chrome',
    },
  },
})

import { defineConfig } from 'vitest/config'
import packageJson from './package.json'

export default defineConfig({
  define: {
    __BKT_SDK_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    setupFiles: ['test/setup.browser.ts'],
    environment: 'happy-dom',
    browser: {
      provider: 'webdriverio',
      name: 'chrome',
    },
  },
})

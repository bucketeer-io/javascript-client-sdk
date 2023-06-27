import { defineConfig } from 'vitest/config'
import packageJson from './package.json'

export default defineConfig({
  define: {
    __BKT_SDK_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    setupFiles: [],
    environment: 'node',
  },
})

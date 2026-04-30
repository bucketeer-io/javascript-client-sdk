import { configDefaults, defineConfig } from 'vitest/config'
import packageJson from './package.json'

export default defineConfig({
  define: {
    __BKT_SDK_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    setupFiles: ['e2e/setup.node.ts'],
    environment: 'node',
    // Exclude browser-only tests that use `vi.resetModules` and browser globals (crypto)
    // from the Node.js E2E suite to avoid runtime errors and unnecessary execution.
    exclude: [
      // Preserve Vitest's default exclusions (node_modules, dist, etc.)
      ...configDefaults.exclude,
      'e2e/idGenerator.browser.spec.ts',
    ],
  },
})

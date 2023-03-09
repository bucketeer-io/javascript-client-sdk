import { resolve } from 'path'
import { defineConfig } from 'vite'
import packageJson from './package.json'

export default defineConfig({
  define: {
    __BKT_SDK_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      name: 'Bucketeer',
      fileName: 'bucketeer',
    },
  },
})

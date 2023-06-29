import { defineBuildConfig } from 'unbuild'
import packageJson from './package.json'

export default defineBuildConfig({
  replace: {
    __BKT_SDK_VERSION__: packageJson.version,
  },
  rollup: {
    replace: {
      // preventAssignment: true,
      delimiters: ['\\${', '}'],
    },
  },
})

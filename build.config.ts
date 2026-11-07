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
    dts: {
      compilerOptions: {
        // Keeps members marked @internal out of the published type files.
        stripInternal: true,
      },
    },
  },
})

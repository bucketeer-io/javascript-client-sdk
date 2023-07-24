// unbuild currently does not support specifying tsconfig.json
// thus it does not read types from globals.d.ts for now
// https://github.com/unjs/unbuild/issues/256
declare const __BKT_SDK_VERSION__: string

export const SDK_VERSION = `${__BKT_SDK_VERSION__}`

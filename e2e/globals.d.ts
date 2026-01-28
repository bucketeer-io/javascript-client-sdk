import type { Assertion, AsymmetricMatchersContaining } from 'vitest'
import type { BKTEvaluation } from '../src/BKTEvaluation'

declare global {
  interface ImportMetaEnv {
    readonly VITE_BKT_API_ENDPOINT: string
    readonly VITE_BKT_API_KEY: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

interface CustomMatchers<R = unknown> {
  toBeEvaluation: (expected: Partial<BKTEvaluation>) => R
}

declare module 'vitest' {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

export {}

import { expect } from 'vitest'
import { BKTEvaluation } from '../src/BKTEvaluation'

interface CustomMatchers<R = unknown> {
  toBeEvaluation(expected: BKTEvaluation): R
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Vi {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Assertion extends CustomMatchers {}
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface AsymmetricMatchersContaining extends CustomMatchers {}
  }
}

expect.extend({
  toBeEvaluation(actual, expected) {
    const result =
      actual != null &&
      actual.id === expected.id &&
      actual.featureId === expected.featureId &&
      actual.featureVersion === expected.featureVersion &&
      actual.userId === expected.userId &&
      actual.variationId === expected.variationId &&
      actual.variationValue === expected.variationValue &&
      actual.reason === expected.reason

    return {
      pass: result,
      message: () => `expected ${actual} to be ${expected}`,
      actual,
      expected,
    }
  },
})

export default {}

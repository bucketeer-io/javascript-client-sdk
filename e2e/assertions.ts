import { expect } from 'vitest'

expect.extend({
  toBeEvaluation(actual, expected) {
    const result =
      actual != null &&
      actual.id === expected.id &&
      actual.featureId === expected.featureId &&
      actual.userId === expected.userId &&
      actual.variationId === expected.variationId &&
      actual.variationName === expected.variationName &&
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

import { expect, suite, test } from 'vitest'
import {
  isRecoverableStatus,
  isTerminalStatus,
} from '../../../src/internal/streaming/httpStatus'

suite('internal/streaming/httpStatus', () => {
  suite('isRecoverableStatus', () => {
    test('undefined (network error / unknown) is recoverable', () => {
      expect(isRecoverableStatus(undefined)).toBe(true)
    })

    test.each([500, 502, 503, 504])('5xx (%i) is recoverable', (status) => {
      expect(isRecoverableStatus(status)).toBe(true)
    })

    test.each([400, 408, 429])(
      'retryable 4xx (%i) is recoverable',
      (status) => {
        expect(isRecoverableStatus(status)).toBe(true)
      },
    )

    // 499 (deployment-related "client closed request") is a dedicated retry
    // case for post.ts's polling requests (see ClientClosedRequestException in
    // post.ts) — a backend rollout that polling survives must not kill the
    // stream via the give-up branch either.
    test('499 (deployment-related client closed request) is recoverable', () => {
      expect(isRecoverableStatus(499)).toBe(true)
    })

    test.each([401, 403, 404, 405])(
      'other 4xx (%i) is not recoverable',
      (status) => {
        expect(isRecoverableStatus(status)).toBe(false)
      },
    )
  })

  suite('isTerminalStatus', () => {
    test.each([401, 403, 404, 405, 406, 410, 413, 414, 415, 422, 431, 451])(
      '%i is terminal',
      (status) => {
        expect(isTerminalStatus(status)).toBe(true)
      },
    )

    test.each([undefined, 400, 402, 408, 409, 428, 429, 500, 503])(
      '%s is not terminal',
      (status) => {
        expect(isTerminalStatus(status)).toBe(false)
      },
    )
  })
})

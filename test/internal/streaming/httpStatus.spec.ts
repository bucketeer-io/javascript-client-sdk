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

    test.each([408, 429])(
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

    test.each([400, 401, 403, 404, 405, 413, 422])(
      'other 4xx (%i) is not recoverable',
      (status) => {
        expect(isRecoverableStatus(status)).toBe(false)
      },
    )
  })

  suite('isTerminalStatus', () => {
    test.each([401, 403, 404, 405, 406, 410, 414, 415, 431, 451])(
      '%i is terminal',
      (status) => {
        expect(isTerminalStatus(status)).toBe(true)
      },
    )

    test.each([undefined, 400, 402, 408, 409, 413, 422, 428, 429, 500, 503])(
      '%s is not terminal',
      (status) => {
        expect(isTerminalStatus(status)).toBe(false)
      },
    )
  })

  // 400, 413, and 422 all depend on the request BODY (attributes, cache
  // state), which changes at runtime via updateUserAttributes() or a cache
  // refresh, just not fast enough for the backoff loop, and not "never" the
  // way a fixed API key or URL is. They belong in neither predicate: not
  // recoverable (no benefit from a tight retry loop), not terminal (a later
  // attempt can genuinely differ). Pinned here explicitly so a future change
  // to either predicate can't silently move one of them into a category by
  // accident.
  suite('statuses that depend on the request body are neither recoverable nor terminal', () => {
    test.each([400, 413, 422])('%i is false for both predicates', (status) => {
      expect(isRecoverableStatus(status)).toBe(false)
      expect(isTerminalStatus(status)).toBe(false)
    })
  })
})

import { expect, suite, test } from 'vitest'

import {
  latencySecondsSince,
  latencyStartMillis,
} from '../../../src/internal/utils/time'

// Regression tests for: "duration is nil and latencySecond is 0".
//
// Before the fix, the JS SDK measured latency with `Date.now()`, which has
// 1ms resolution. For sub-millisecond network responses (cached responses,
// fast LANs, very small payloads on a hot fetch path) `(Date.now() -
// startTime) / 1000` rounded to exactly 0, the SDK shipped
// `latencySecond: 0`, and the backend rejected the metrics event. The fix
// replaces the timer with `performance.now()` (sub-millisecond, monotonic).

suite('internal/utils/time', () => {
  test('latencyStartMillis returns a finite number', () => {
    const start = latencyStartMillis()
    expect(typeof start).toBe('number')
    expect(Number.isFinite(start)).toBe(true)
  })

  test('latencySecondsSince returns a finite, non-negative number', () => {
    const start = latencyStartMillis()
    const elapsed = latencySecondsSince(start)
    expect(typeof elapsed).toBe('number')
    expect(Number.isFinite(elapsed)).toBe(true)
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  test('latencySecondsSince > 0 for an awaited microtask (regression for "latencySecond is 0")', async () => {
    // The most realistic SDK scenario: a fetch call that resolves quickly.
    // `await` schedules a microtask, which always takes >> 1ns. With the
    // old `Date.now()` clock this measurement routinely came back 0; with
    // `performance.now()` it must be strictly > 0 every time.
    for (let i = 0; i < 100; i++) {
      const start = latencyStartMillis()
      await Promise.resolve()
      const second = latencySecondsSince(start)
      expect(
        second,
        `iteration ${i}: expected latencySecondsSince > 0 for an awaited microtask, got ${second}`,
      ).toBeGreaterThan(0)
    }
  })

  test('latencySecondsSince has sub-millisecond resolution (proves the fix)', async () => {
    // The pre-fix `Date.now()` timer has 1ms granularity, so this assertion
    // would have been impossible to satisfy. Show that the new helper can
    // measure intervals smaller than 1 millisecond. We sample several
    // microtasks; at least one should come back below 1ms on any
    // reasonable hardware.
    let sawSubMs = false
    for (let i = 0; i < 50; i++) {
      const start = latencyStartMillis()
      await Promise.resolve()
      const second = latencySecondsSince(start)
      if (second > 0 && second < 0.001) {
        sawSubMs = true
        break
      }
    }
    expect(
      sawSubMs,
      'expected at least one awaited microtask to measure < 1ms with the new helper',
    ).toBe(true)
  })

  test('latencySecondsSince matches a parallel performance.now() reading', () => {
    // Sanity: the helper actually divides the performance.now() diff by
    // 1000. Compute the same interval independently and confirm the
    // helper's value is consistent with it.
    const start = latencyStartMillis()
    const perfStart = performance.now()
    // tiny burn of work so the interval is non-zero
    let acc = 0
    for (let i = 0; i < 1000; i++) {
      acc += Math.sqrt(i)
    }
    expect(acc).toBeGreaterThan(0)
    const second = latencySecondsSince(start)
    const perfDiffSec = (performance.now() - perfStart) / 1000
    expect(second).toBeGreaterThan(0)
    // helper measured BEFORE the second performance.now() read, so it
    // must be <= the independently-computed value (with a small ε for
    // jitter).
    expect(second).toBeLessThanOrEqual(perfDiffSec + 1e-6)
  })
})

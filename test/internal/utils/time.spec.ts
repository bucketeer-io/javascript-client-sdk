import { afterEach, expect, suite, test, vi } from 'vitest'

import {
  latencySecondsSince,
  latencyStartMillis,
} from '../../../src/internal/utils/time'

// Regression tests for: "duration is nil and latencySecond is 0".
//
// Before the fix, the JS SDK measured latency with `Date.now()`, which has
// 1ms resolution. For sub-millisecond network responses
// `(Date.now() - startTime) / 1000` rounded to exactly 0, the SDK shipped
// `latencySecond: 0`, and the backend rejected the metrics event. The fix
// swaps the timer for `performance.now()` AND clamps the helper's return
// value to a small positive minimum so that even in browsers that
// quantize `performance.now()` to 1 ms (Firefox / Safari without
// cross-origin isolation) we never emit a zero.
//
// These tests stub `performance.now()` directly so they are fully
// deterministic regardless of the host's scheduler or clock resolution.

suite('internal/utils/time', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('latencyStartMillis returns whatever performance.now() returns', () => {
    const spy = vi.spyOn(performance, 'now').mockReturnValue(123_456.789)
    expect(latencyStartMillis()).toBe(123_456.789)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('latencySecondsSince converts the millisecond delta to seconds exactly', () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000) // start
      .mockReturnValueOnce(2_500) // end
    const start = latencyStartMillis()
    const elapsed = latencySecondsSince(start)
    expect(elapsed).toBeCloseTo(1.5, 10)
  })

  test('latencySecondsSince preserves sub-millisecond fractional intervals', () => {
    // Real `performance.now()` returns ms with a fractional part. This is
    // the exact resolution that `Date.now()` lacked and that the fix
    // restores. Stub to a 250 µs interval and assert we get 0.00025 s.
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10.0) // start (ms)
      .mockReturnValueOnce(10.25) // end (ms)  -> diff = 0.25 ms = 250 µs
    const start = latencyStartMillis()
    expect(latencySecondsSince(start)).toBeCloseTo(0.00025, 12)
  })

  test('latencySecondsSince clamps to a positive minimum when the clock has not advanced (regression for "latencySecond is 0")', () => {
    // The core regression. In Firefox/Safari without cross-origin
    // isolation, `performance.now()` is quantized to 1 ms, so two reads
    // inside the same 1 ms tick produce a diff of exactly 0. The pre-fix
    // SDK shipped that as `latencySecond: 0` and the backend rejected
    // the event. The helper must clamp to a positive value so this
    // payload is never emitted again.
    vi.spyOn(performance, 'now').mockReturnValue(42.0)
    const start = latencyStartMillis()
    const elapsed = latencySecondsSince(start)
    expect(elapsed).toBeGreaterThan(0)
    // Should be the documented 1 µs floor, not some unspecified epsilon.
    expect(elapsed).toBe(1e-6)
  })

  test('latencySecondsSince clamps a negative interval to the positive minimum', () => {
    // Defensive: if the (stubbed) clock ever appears to go backwards,
    // the helper must still report a positive latency rather than a
    // negative number that the backend would silently bucket.
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(99)
    const start = latencyStartMillis()
    expect(latencySecondsSince(start)).toBe(1e-6)
  })

  test('latencySecondsSince returns the raw delta (not the clamp) when it exceeds the minimum', () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(50) // 50 ms = 0.05 s, well above the 1 µs floor
    const start = latencyStartMillis()
    expect(latencySecondsSince(start)).toBeCloseTo(0.05, 10)
  })
})

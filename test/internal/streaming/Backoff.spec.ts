import { expect, suite, test, vi, afterEach } from 'vitest'
import { Backoff } from '../../../src/internal/streaming/Backoff'
import { FakeClock } from '../../utils'

suite('internal/streaming/Backoff', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  suite('nextDelayMillis', () => {
    test('starts at initialDelayMillis and doubles until maxDelayMillis, then caps', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const backoff = new Backoff(1_000, 30_000, 60_000, new FakeClock())

      expect(backoff.nextDelayMillis()).toBe(1_000)
      expect(backoff.nextDelayMillis()).toBe(2_000)
      expect(backoff.nextDelayMillis()).toBe(4_000)
      expect(backoff.nextDelayMillis()).toBe(8_000)
      expect(backoff.nextDelayMillis()).toBe(16_000)
      expect(backoff.nextDelayMillis()).toBe(30_000)
      expect(backoff.nextDelayMillis()).toBe(30_000)
    })

    test('clamps an initialDelayMillis greater than maxDelayMillis on the first call', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const backoff = new Backoff(40_000, 30_000, 60_000, new FakeClock())

      expect(backoff.nextDelayMillis()).toBe(30_000)
    })

    test('subtracts up to JITTER_RATIO of the base delay', () => {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const backoff = new Backoff(1_000, 30_000, 60_000, new FakeClock())

      // base 1_000, JITTER_RATIO 0.5, random 1 -> subtract the full 50%
      expect(backoff.nextDelayMillis()).toBe(500)
      expect(backoff.nextDelayMillis()).toBe(1_000)
    })
  })

  suite('success', () => {
    test('does not reset attempt when the gap since the last success is within resetIntervalMillis', () => {
      const clock = new FakeClock()
      const backoff = new Backoff(1_000, 30_000, 60_000, clock)
      vi.spyOn(Math, 'random').mockReturnValue(0)

      clock.setCurrentTimeSeconds(1_000)
      backoff.success()
      expect(backoff.nextDelayMillis()).toBe(1_000)

      clock.setCurrentTimeSeconds(1_030) // 30s later, within the 60s reset window
      backoff.success()

      expect(backoff.nextDelayMillis()).toBe(2_000)
    })

    test('resets attempt when the gap since the last success exceeds resetIntervalMillis', () => {
      const clock = new FakeClock()
      const backoff = new Backoff(1_000, 30_000, 60_000, clock)
      vi.spyOn(Math, 'random').mockReturnValue(0)

      clock.setCurrentTimeSeconds(1_000)
      backoff.success()
      expect(backoff.nextDelayMillis()).toBe(1_000)
      expect(backoff.nextDelayMillis()).toBe(2_000)

      clock.setCurrentTimeSeconds(1_000 + 61) // 61s later, past the 60s reset window
      backoff.success()

      expect(backoff.nextDelayMillis()).toBe(1_000)
    })

    test('the first success call never resets attempt', () => {
      const clock = new FakeClock()
      const backoff = new Backoff(1_000, 30_000, 60_000, clock)
      vi.spyOn(Math, 'random').mockReturnValue(0)

      expect(backoff.nextDelayMillis()).toBe(1_000)
      expect(backoff.nextDelayMillis()).toBe(2_000)

      clock.setCurrentTimeSeconds(1_000_000)
      backoff.success()

      expect(backoff.nextDelayMillis()).toBe(4_000)
    })
  })

  suite('reset', () => {
    test('sets attempt back to 0', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const backoff = new Backoff(1_000, 30_000, 60_000, new FakeClock())

      expect(backoff.nextDelayMillis()).toBe(1_000)
      expect(backoff.nextDelayMillis()).toBe(2_000)

      backoff.reset()

      expect(backoff.nextDelayMillis()).toBe(1_000)
    })
  })
})

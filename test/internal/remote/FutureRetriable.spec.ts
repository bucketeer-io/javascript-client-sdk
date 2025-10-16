import { afterEach, beforeEach, expect, suite, test, vi } from 'vitest'

import {
  futureRetriable,
  RetryPolicy,
  ShouldRetryFn,
} from '../../../src/internal/remote/FutureRetriable'

suite('futureRetriable', () => {
  const policy: RetryPolicy = {
    maxRetries: 3,
    delay: 100,
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('resolves when fn eventually succeeds', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('success')

    const shouldRetry: ShouldRetryFn = vi.fn(() => true)

    const resultPromise = futureRetriable(fn, policy, shouldRetry)
    const expectation = expect(resultPromise).resolves.toBe('success')

    await vi.runAllTimersAsync()

    await expectation
    expect(fn).toHaveBeenCalledTimes(2)
    expect(shouldRetry).toHaveBeenCalledTimes(1)
  })

  test('waits for configured delay before retrying', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('success')
    const shouldRetry: ShouldRetryFn = vi.fn(() => true)
    const delay = 250
    const resultPromise = futureRetriable(
      fn,
      { ...policy, maxRetries: 2, delay },
      shouldRetry,
    )
    const expectation = expect(resultPromise).resolves.toBe('success')

    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(fn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(shouldRetry).toHaveBeenCalledTimes(1)

    await expectation
  })

  test('throws the last error after exceeding max retries', async () => {
    const error = new Error('permanent failure')
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(error)
    const shouldRetry: ShouldRetryFn = vi.fn(() => true)

    const resultPromise = futureRetriable(
      fn,
      { ...policy, maxRetries: 2, delay: 10 },
      shouldRetry,
    )

    const expectation = expect(resultPromise).rejects.toBe(error)

    await vi.runAllTimersAsync()

    await expectation
    expect(fn).toHaveBeenCalledTimes(3)
    expect(shouldRetry).toHaveBeenCalledTimes(2)
  })

  test('does not retry when shouldRetry returns false', async () => {
    const error = new Error('do not retry')
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(error)
    const shouldRetry: ShouldRetryFn = vi.fn(() => false)

    const resultPromise = futureRetriable(fn, policy, shouldRetry)

    await expect(resultPromise).rejects.toBe(error)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(shouldRetry).toHaveBeenCalledTimes(1)
  })

  test('stops retrying once shouldRetry returns false mid-sequence', async () => {
    const error = new Error('stop retrying')
    const delay = 150
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(error)
    const shouldRetry = vi
      .fn<ShouldRetryFn>()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false)

    const resultPromise = futureRetriable(
      fn,
      { ...policy, maxRetries: 4, delay },
      shouldRetry,
    )
    const expectation = expect(resultPromise).rejects.toBe(error)

    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(shouldRetry).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(delay)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(shouldRetry).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(delay)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(shouldRetry).toHaveBeenCalledTimes(3)

    await expectation
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

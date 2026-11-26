import { afterEach, beforeEach, expect, suite, test, vi } from 'vitest'

import {
  InternalServerErrorException,
  NetworkException,
  ServiceUnavailableException,
} from '../../../src/BKTExceptions'
import { EvaluationSyncStatusTrackerImpl } from '../../../src/internal/evaluation/EvaluationSyncStatusTracker'
import { FakeClock } from '../../utils'

suite('internal/evaluation/EvaluationSyncStatusTracker', () => {
  const START_SECONDS = 1_000
  const START_MILLIS = START_SECONDS * 1_000
  const serverError = new InternalServerErrorException('Internal Server Error')
  const unavailable = new ServiceUnavailableException('Service Unavailable')
  const networkError = new NetworkException('Network Error: down')
  // How long a stream give-up waits before it is applied.
  const STREAM_WAIT_MILLIS = 10_000

  let clock: FakeClock
  let tracker: EvaluationSyncStatusTrackerImpl

  beforeEach(() => {
    vi.useFakeTimers()
    clock = new FakeClock()
    clock.setCurrentTimeSeconds(START_SECONDS)
    let nextId = 0
    tracker = new EvaluationSyncStatusTrackerImpl(clock, {
      newId: () => `listener_${nextId++}`,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function moveToSeconds(seconds: number): number {
    clock.setCurrentTimeSeconds(seconds)
    return seconds * 1_000
  }

  // The state after a successful init in polling mode.
  function makeSynced(): void {
    tracker.reportSuccess('POLLING')
    tracker.finishInitializing(true)
  }

  // FAILING after a successful init: the poller used up its retries.
  function makeFailing(): void {
    makeSynced()
    tracker.reportFailure('POLLING', serverError)
  }

  suite('during init', () => {
    test('starts as INITIALIZING with no sync time and no error', () => {
      expect(tracker.getStatus()).toEqual({
        state: 'INITIALIZING',
        changedAt: START_MILLIS,
        lastSyncedAt: null,
        lastError: null,
      })
    })

    test('a failure updates lastError and calls listeners, but the state stays INITIALIZING', () => {
      const listener = vi.fn()
      tracker.addListener(listener)

      const failedAt = moveToSeconds(START_SECONDS + 1)
      tracker.reportFailure('POLLING', unavailable)

      const status = tracker.getStatus()
      expect(status.state).toBe('INITIALIZING')
      expect(status.changedAt).toBe(START_MILLIS)
      expect(status.lastError).toEqual({
        cause: unavailable,
        occurredAt: failedAt,
        source: 'POLLING',
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)
    })

    test('a success sets SYNCED at once and sets lastSyncedAt', () => {
      const syncedAt = moveToSeconds(START_SECONDS + 1)

      tracker.reportSuccess('STREAMING')

      const status = tracker.getStatus()
      expect(status.state).toBe('SYNCED')
      expect(status.changedAt).toBe(syncedAt)
      expect(status.lastSyncedAt).toBe(syncedAt)
    })
  })

  suite('finishInitializing', () => {
    test('a failed init request keeps INITIALIZING and calls no listener', () => {
      const listener = vi.fn()
      tracker.addListener(listener)
      const before = tracker.getStatus()

      moveToSeconds(START_SECONDS + 5)
      tracker.finishInitializing(false)

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()
    })

    test('after a failed init request, a failure report moves INITIALIZING to FAILING', () => {
      tracker.finishInitializing(false)
      const listener = vi.fn()
      tracker.addListener(listener)

      const failedAt = moveToSeconds(START_SECONDS + 300)
      tracker.reportFailure('POLLING', unavailable)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(failedAt)
      expect(status.lastError).toEqual({
        cause: unavailable,
        occurredAt: failedAt,
        source: 'POLLING',
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)
    })

    test('an init error not related to the request sets FAILING with that error and calls the listener once', () => {
      const listener = vi.fn()
      tracker.addListener(listener)

      const finishedAt = moveToSeconds(START_SECONDS + 5)
      tracker.finishInitializing(false, serverError)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(finishedAt)
      expect(status.lastError).toEqual({
        cause: serverError,
        occurredAt: finishedAt,
        source: 'POLLING',
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)
    })

    test('an init error changes nothing when a success already set SYNCED', () => {
      tracker.reportSuccess('STREAMING')
      const before = tracker.getStatus()
      const listener = vi.fn()
      tracker.addListener(listener)

      tracker.finishInitializing(false, serverError)

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()
    })

    test('a successful init changes nothing when a success already set SYNCED', () => {
      tracker.reportSuccess('POLLING')
      const before = tracker.getStatus()
      const listener = vi.fn()
      tracker.addListener(listener)

      tracker.finishInitializing(true)

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  suite('after init', () => {
    test('SYNCED to FAILING sets the state, changedAt and lastError, and calls the listener', () => {
      makeSynced()
      const listener = vi.fn()
      tracker.addListener(listener)

      const failedAt = moveToSeconds(START_SECONDS + 10)
      tracker.reportFailure('POLLING', serverError)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(failedAt)
      expect(status.lastError).toEqual({
        cause: serverError,
        occurredAt: failedAt,
        source: 'POLLING',
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)
    })

    test('FAILING to FAILING calls the listener with the new error and keeps changedAt', () => {
      makeSynced()
      const firstFailureAt = moveToSeconds(START_SECONDS + 10)
      tracker.reportFailure('POLLING', serverError)
      const listener = vi.fn()
      tracker.addListener(listener)

      const secondFailureAt = moveToSeconds(START_SECONDS + 20)
      tracker.reportFailure('POLLING', unavailable)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(firstFailureAt)
      expect(status.lastError).toEqual({
        cause: unavailable,
        occurredAt: secondFailureAt,
        source: 'POLLING',
      })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    test('FAILING to SYNCED calls the listener, keeps lastError and updates lastSyncedAt', () => {
      makeFailing()
      const errorBefore = tracker.getStatus().lastError
      const listener = vi.fn()
      tracker.addListener(listener)

      const syncedAt = moveToSeconds(START_SECONDS + 10)
      tracker.reportSuccess('POLLING')

      const status = tracker.getStatus()
      expect(status.state).toBe('SYNCED')
      expect(status.changedAt).toBe(syncedAt)
      expect(status.lastSyncedAt).toBe(syncedAt)
      expect(status.lastError).toEqual(errorBefore)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    test('SYNCED to SYNCED updates lastSyncedAt only and does not call the listener', () => {
      makeSynced()
      const changedAtBefore = tracker.getStatus().changedAt
      const listener = vi.fn()
      tracker.addListener(listener)

      const syncedAt = moveToSeconds(START_SECONDS + 10)
      tracker.reportSuccess('POLLING')

      const status = tracker.getStatus()
      expect(status.lastSyncedAt).toBe(syncedAt)
      expect(status.changedAt).toBe(changedAtBefore)
      expect(listener).not.toHaveBeenCalled()
    })

    test('a success from either source ends a failure from the other source', () => {
      makeSynced()

      tracker.reportFailure('POLLING', serverError)
      tracker.reportSuccess('STREAMING')
      expect(tracker.getStatus().state).toBe('SYNCED')

      tracker.reportFailure('STREAMING', unavailable)
      vi.advanceTimersByTime(STREAM_WAIT_MILLIS)
      expect(tracker.getStatus().state).toBe('FAILING')
      tracker.reportSuccess('POLLING')
      expect(tracker.getStatus().state).toBe('SYNCED')
    })
  })

  suite('stream give-up waits before it is applied', () => {
    test('nothing changes until the wait ends, then FAILING with the stream error and one listener call', () => {
      makeSynced()
      const before = tracker.getStatus()
      const listener = vi.fn()
      tracker.addListener(listener)

      const gaveUpAt = moveToSeconds(START_SECONDS + 120)
      tracker.reportFailure('STREAMING', unavailable)
      vi.advanceTimersByTime(STREAM_WAIT_MILLIS - 1)

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()

      const appliedAt = moveToSeconds(START_SECONDS + 130)
      vi.advanceTimersByTime(1)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      // changedAt: when the state changed (after the wait). occurredAt: when
      // the stream gave up.
      expect(status.changedAt).toBe(appliedAt)
      expect(status.lastError).toEqual({
        cause: unavailable,
        occurredAt: gaveUpAt,
        source: 'STREAMING',
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)
    })

    test('it is still applied when the polling fallback starts during the wait', () => {
      makeSynced()

      tracker.reportFailure('STREAMING', unavailable)
      tracker.setPollingFallbackActive(true)
      vi.advanceTimersByTime(STREAM_WAIT_MILLIS)

      expect(tracker.getStatus().state).toBe('FAILING')
      expect(tracker.getStatus().lastError?.cause).toBe(unavailable)
    })

    test('a success during the wait cancels it', () => {
      makeSynced()
      const listener = vi.fn()
      tracker.addListener(listener)

      tracker.reportFailure('STREAMING', unavailable)
      tracker.setPollingFallbackActive(true)
      tracker.reportSuccess('POLLING')
      vi.advanceTimersByTime(STREAM_WAIT_MILLIS)

      expect(tracker.getStatus().state).toBe('SYNCED')
      expect(tracker.getStatus().lastError).toBeNull()
      expect(listener).not.toHaveBeenCalled()
    })

    test('a polling failure during the 10 s stream give-up wait cancels the wait and applies the stream error at once', () => {
      makeSynced()
      const listener = vi.fn()
      tracker.addListener(listener)

      const gaveUpAt = moveToSeconds(START_SECONDS + 120)
      tracker.reportFailure('STREAMING', unavailable)
      tracker.setPollingFallbackActive(true)
      const pollFailedAt = moveToSeconds(START_SECONDS + 121)
      tracker.reportFailure('POLLING', serverError)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(pollFailedAt)
      expect(status.lastError).toEqual({
        cause: unavailable,
        occurredAt: gaveUpAt,
        source: 'STREAMING',
      })
      expect(listener).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(STREAM_WAIT_MILLIS)
      expect(listener).toHaveBeenCalledTimes(1)

      tracker.reportFailure('POLLING', networkError)
      expect(tracker.getStatus().lastError?.source).toBe('POLLING')
    })

    test('destroy during the wait cancels it', () => {
      makeSynced()
      const listener = vi.fn()
      tracker.addListener(listener)

      tracker.reportFailure('STREAMING', unavailable)
      tracker.markDestroyed()
      const destroyed = tracker.getStatus()
      vi.advanceTimersByTime(STREAM_WAIT_MILLIS)

      expect(tracker.getStatus()).toEqual(destroyed)
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  suite('stream failures while the polling fallback runs', () => {
    test('a streaming failure changes nothing and calls no listener', () => {
      makeSynced()
      tracker.setPollingFallbackActive(true)
      const before = tracker.getStatus()
      const listener = vi.fn()
      tracker.addListener(listener)

      moveToSeconds(START_SECONDS + 10)
      tracker.reportFailure('STREAMING', unavailable)

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()
    })

    test('streaming failures count again after the fallback stops', () => {
      makeSynced()
      tracker.setPollingFallbackActive(true)
      tracker.setPollingFallbackActive(false)

      tracker.reportFailure('STREAMING', unavailable)
      vi.advanceTimersByTime(STREAM_WAIT_MILLIS)

      expect(tracker.getStatus().state).toBe('FAILING')
      expect(tracker.getStatus().lastError?.source).toBe('STREAMING')
    })
  })

  suite('polling failures while the stream works', () => {
    test('a polling failure changes nothing after a streaming success', () => {
      makeSynced()
      tracker.reportSuccess('STREAMING')
      const before = tracker.getStatus()
      const listener = vi.fn()
      tracker.addListener(listener)

      moveToSeconds(START_SECONDS + 10)
      tracker.reportFailure('POLLING', networkError)

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()
    })

    test('polling failures count again after the stream is marked as not working', () => {
      makeSynced()
      tracker.reportSuccess('STREAMING')
      tracker.markStreamNotWorking()

      const failedAt = moveToSeconds(START_SECONDS + 10)
      tracker.reportFailure('POLLING', networkError)

      expect(tracker.getStatus().lastError).toEqual({
        cause: networkError,
        occurredAt: failedAt,
        source: 'POLLING',
      })
    })

    test('polling failures count again after a streaming failure', () => {
      makeSynced()
      tracker.reportSuccess('STREAMING')
      tracker.reportFailure('STREAMING', unavailable)
      // Past the 10 s stream give-up wait: a polling failure during it would
      // apply the stream error instead.
      vi.advanceTimersByTime(STREAM_WAIT_MILLIS)

      const failedAt = moveToSeconds(START_SECONDS + 10)
      tracker.reportFailure('POLLING', networkError)

      expect(tracker.getStatus().lastError).toEqual({
        cause: networkError,
        occurredAt: failedAt,
        source: 'POLLING',
      })
    })
  })

  suite('reportStreamingAlive', () => {
    test('while the stream works, it updates lastSyncedAt only and calls no listener', () => {
      tracker.reportSuccess('STREAMING')
      const changedAtBefore = tracker.getStatus().changedAt
      const listener = vi.fn()
      tracker.addListener(listener)

      const aliveAt = moveToSeconds(START_SECONDS + 30)
      tracker.reportStreamingAlive()

      const status = tracker.getStatus()
      expect(status.lastSyncedAt).toBe(aliveAt)
      expect(status.changedAt).toBe(changedAtBefore)
      expect(listener).not.toHaveBeenCalled()
    })

    test('before the first stream data, it changes nothing', () => {
      makeSynced()
      const before = tracker.getStatus()

      moveToSeconds(START_SECONDS + 30)
      tracker.reportStreamingAlive()

      expect(tracker.getStatus()).toEqual(before)
    })

    test('after the stream is marked as not working, it changes nothing and calls no listener', () => {
      tracker.reportSuccess('STREAMING')
      const listener = vi.fn()
      tracker.addListener(listener)
      tracker.markStreamNotWorking()
      const before = tracker.getStatus()

      moveToSeconds(START_SECONDS + 30)
      tracker.reportStreamingAlive()

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()
    })

    test('after a stream failure, it changes nothing', () => {
      tracker.reportSuccess('STREAMING')
      tracker.reportFailure('STREAMING', unavailable)
      const before = tracker.getStatus()

      moveToSeconds(START_SECONDS + 30)
      tracker.reportStreamingAlive()

      expect(tracker.getStatus()).toEqual(before)
    })
  })

  suite('markDestroyed', () => {
    test('sets DESTROYED, calls the listener once, removes listeners, and later reports do nothing', () => {
      makeSynced()
      const listener = vi.fn()
      tracker.addListener(listener)

      const destroyedAt = moveToSeconds(START_SECONDS + 10)
      tracker.markDestroyed()

      const status = tracker.getStatus()
      expect(status.state).toBe('DESTROYED')
      expect(status.changedAt).toBe(destroyedAt)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)

      moveToSeconds(START_SECONDS + 20)
      tracker.reportFailure('POLLING', serverError)
      tracker.reportSuccess('POLLING')
      tracker.reportStreamingAlive()
      tracker.finishInitializing(false)

      expect(tracker.getStatus()).toEqual(status)
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  suite('getStatus', () => {
    test('returns a copy, so a caller cannot change the status', () => {
      makeSynced()

      const first = tracker.getStatus()
      ;(first as { state: string }).state = 'FAILING'

      expect(tracker.getStatus().state).toBe('SYNCED')
    })
  })

  suite('listeners', () => {
    test('a removed listener is not called', () => {
      const removed = vi.fn()
      const kept = vi.fn()
      const id = tracker.addListener(removed)
      tracker.addListener(kept)

      tracker.removeListener(id)
      tracker.reportFailure('POLLING', serverError)

      expect(removed).not.toHaveBeenCalled()
      expect(kept).toHaveBeenCalledTimes(1)
    })

    test('clearListeners removes every listener', () => {
      const first = vi.fn()
      const second = vi.fn()
      tracker.addListener(first)
      tracker.addListener(second)

      tracker.clearListeners()
      tracker.reportFailure('POLLING', serverError)

      expect(first).not.toHaveBeenCalled()
      expect(second).not.toHaveBeenCalled()
    })

    test('when a listener destroys the client, the other listeners get DESTROYED once and nothing after it', () => {
      makeSynced()
      const calls: string[] = []
      tracker.addListener((status) => {
        calls.push(`A:${status.state}`)
        if (status.state === 'FAILING') tracker.markDestroyed()
      })
      tracker.addListener((status) => {
        calls.push(`B:${status.state}`)
      })

      tracker.reportFailure('POLLING', serverError)

      expect(calls).toEqual(['A:FAILING', 'A:DESTROYED', 'B:DESTROYED'])
    })

    test('a listener removed by another listener during a call is not called', () => {
      const removed = vi.fn()
      let removedId = ''
      tracker.addListener(() => tracker.removeListener(removedId))
      removedId = tracker.addListener(removed)

      tracker.reportFailure('POLLING', serverError)

      expect(removed).not.toHaveBeenCalled()
    })

    test('a listener that throws does not stop other listeners and does not throw to the caller', () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const next = vi.fn()
      tracker.addListener(() => {
        throw new Error('app listener failed')
      })
      tracker.addListener(next)

      expect(() =>
        tracker.reportFailure('POLLING', serverError),
      ).not.toThrow()

      expect(next).toHaveBeenCalledTimes(1)
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })
  })
})

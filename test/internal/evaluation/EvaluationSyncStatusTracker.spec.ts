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
    tracker.reportSuccess()
  }

  // FAILING after a successful init: the poller used up its retries.
  function makeFailing(): void {
    makeSynced()
    tracker.reportFailure(serverError)
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

    // A flow reports a failure only after its retries, so a failure during
    // init is a real result: FAILING at once, like after init.
    test('a reported failure during init sets FAILING at once', () => {
      const listener = vi.fn()
      tracker.addListener(listener)

      const failedAt = moveToSeconds(START_SECONDS + 1)
      tracker.reportFailure(unavailable)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(failedAt)
      expect(status.lastError).toEqual({
        cause: unavailable,
        occurredAt: failedAt,
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)
    })

    test('a success sets SYNCED at once and sets lastSyncedAt', () => {
      const syncedAt = moveToSeconds(START_SECONDS + 1)

      tracker.reportSuccess()

      const status = tracker.getStatus()
      expect(status.state).toBe('SYNCED')
      expect(status.changedAt).toBe(syncedAt)
      expect(status.lastSyncedAt).toBe(syncedAt)
    })
  })

  suite('reportInitError', () => {
    test('an init error not related to the request sets FAILING with that error and calls the listener once', () => {
      const listener = vi.fn()
      tracker.addListener(listener)

      const finishedAt = moveToSeconds(START_SECONDS + 5)
      tracker.reportInitError(serverError)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(finishedAt)
      expect(status.lastError).toEqual({
        cause: serverError,
        occurredAt: finishedAt,
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)
    })

    test('an init error changes nothing when a success already set SYNCED', () => {
      tracker.reportSuccess()
      const before = tracker.getStatus()
      const listener = vi.fn()
      tracker.addListener(listener)

      tracker.reportInitError(serverError)

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
      tracker.reportFailure(serverError)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(failedAt)
      expect(status.lastError).toEqual({
        cause: serverError,
        occurredAt: failedAt,
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)
    })

    test('FAILING to FAILING calls the listener with the new error and keeps changedAt', () => {
      makeSynced()
      const firstFailureAt = moveToSeconds(START_SECONDS + 10)
      tracker.reportFailure(serverError)
      const listener = vi.fn()
      tracker.addListener(listener)

      const secondFailureAt = moveToSeconds(START_SECONDS + 20)
      tracker.reportFailure(unavailable)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(firstFailureAt)
      expect(status.lastError).toEqual({
        cause: unavailable,
        occurredAt: secondFailureAt,
      })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    test('FAILING to SYNCED calls the listener, keeps lastError and updates lastSyncedAt', () => {
      makeFailing()
      const errorBefore = tracker.getStatus().lastError
      const listener = vi.fn()
      tracker.addListener(listener)

      const syncedAt = moveToSeconds(START_SECONDS + 10)
      tracker.reportSuccess()

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
      tracker.reportSuccess()

      const status = tracker.getStatus()
      expect(status.lastSyncedAt).toBe(syncedAt)
      expect(status.changedAt).toBe(changedAtBefore)
      expect(listener).not.toHaveBeenCalled()
    })

    test('a streaming success ends a polling failure', () => {
      makeFailing()

      tracker.markStreamWorking()
      tracker.reportSuccess()

      expect(tracker.getStatus().state).toBe('SYNCED')
    })

    test('markStreamWorking() calls no listener and does not change the status', () => {
      makeFailing()
      const before = tracker.getStatus()
      const listener = vi.fn()
      tracker.addListener(listener)

      moveToSeconds(START_SECONDS + 10)
      tracker.markStreamWorking()

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  // The stream never reports a failure (see StreamingSyncReporter). After a
  // stream give-up, only polling results decide the state, with no wait.
  suite('only polling reports failures', () => {
    test('a polling failure sets FAILING at once, with no wait', () => {
      makeSynced()
      const listener = vi.fn()
      tracker.addListener(listener)

      const failedAt = moveToSeconds(START_SECONDS + 120)
      tracker.reportFailure(unavailable)

      const status = tracker.getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.changedAt).toBe(failedAt)
      expect(status.lastError).toEqual({
        cause: unavailable,
        occurredAt: failedAt,
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(status)
    })
  })

  suite('polling failures while the stream works', () => {
    test('a polling failure changes nothing while the stream works', () => {
      makeSynced()
      tracker.markStreamWorking()
      const before = tracker.getStatus()
      const listener = vi.fn()
      tracker.addListener(listener)

      moveToSeconds(START_SECONDS + 10)
      tracker.reportFailure(networkError)

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()
    })

    test('polling failures count again after the stream is marked as not working', () => {
      makeSynced()
      tracker.markStreamWorking()
      tracker.markStreamNotWorking()

      const failedAt = moveToSeconds(START_SECONDS + 10)
      tracker.reportFailure(networkError)

      expect(tracker.getStatus().lastError).toEqual({
        cause: networkError,
        occurredAt: failedAt,
      })
    })
  })

  suite('reportStreamingAlive', () => {
    test('while the stream works, it updates lastSyncedAt only and calls no listener', () => {
      tracker.markStreamWorking()
      tracker.reportSuccess()
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
      tracker.markStreamWorking()
      tracker.reportSuccess()
      const listener = vi.fn()
      tracker.addListener(listener)
      tracker.markStreamNotWorking()
      const before = tracker.getStatus()

      moveToSeconds(START_SECONDS + 30)
      tracker.reportStreamingAlive()

      expect(tracker.getStatus()).toEqual(before)
      expect(listener).not.toHaveBeenCalled()
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
      tracker.reportFailure(serverError)
      tracker.reportSuccess()
      tracker.markStreamWorking()
      tracker.reportStreamingAlive()
      tracker.reportInitError(serverError)

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
      tracker.reportFailure(serverError)

      expect(removed).not.toHaveBeenCalled()
      expect(kept).toHaveBeenCalledTimes(1)
    })

    test('clearListeners removes every listener', () => {
      const first = vi.fn()
      const second = vi.fn()
      tracker.addListener(first)
      tracker.addListener(second)

      tracker.clearListeners()
      tracker.reportFailure(serverError)

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

      tracker.reportFailure(serverError)

      expect(calls).toEqual(['A:FAILING', 'A:DESTROYED', 'B:DESTROYED'])
    })

    test('a listener removed by another listener during a call is not called', () => {
      const removed = vi.fn()
      let removedId = ''
      tracker.addListener(() => tracker.removeListener(removedId))
      removedId = tracker.addListener(removed)

      tracker.reportFailure(serverError)

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

      expect(() => tracker.reportFailure(serverError)).not.toThrow()

      expect(next).toHaveBeenCalledTimes(1)
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })
  })
})

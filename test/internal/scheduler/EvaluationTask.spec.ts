import { http, HttpResponse } from 'msw'
import { SetupServer } from 'msw/node'
import {
  beforeEach,
  afterEach,
  expect,
  suite,
  test,
  vi,
  afterAll,
  beforeAll,
} from 'vitest'

import { BKTClientImpl, destroyBKTClient } from '../../../src/BKTClient'
import { BKTConfig, defineBKTConfig } from '../../../src/BKTConfig'
import { DefaultComponent } from '../../../src/internal/di/Component'
import { DataModule } from '../../../src/internal/di/DataModule'
import { TestPlatformModule, setupServerAndListen } from '../../utils'
import { InteractorModule } from '../../../src/internal/di/InteractorModule'
import { user1 } from '../../mocks/users'
import { user1Evaluations } from '../../mocks/evaluations'
import { EvaluationTask } from '../../../src/internal/scheduler/EvaluationTask'
import { GetEvaluationsRequest } from '../../../src/internal/model/request/GetEvaluationsRequest'
import { GetEvaluationsResponse } from '../../../src/internal/model/response/GetEvaluationsResponse'
import { requiredInternalConfig } from '../../../src/internal/InternalConfig'
import {
  IllegalStateException,
  InternalServerErrorException,
} from '../../../src/BKTExceptions'

suite('internal/scheduler/EventTask', () => {
  let server: SetupServer
  let config: BKTConfig
  let component: DefaultComponent
  let task: EvaluationTask | undefined

  beforeAll(() => {
    server = setupServerAndListen()
  })

  beforeEach(async () => {
    vi.useFakeTimers()

    config = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value',
      appVersion: '1.2.3',
      eventsMaxQueueSize: 3,
      pollingInterval: 1_000 * 120, // 2 minutes
      fetch,
    })

    component = new DefaultComponent(
      new TestPlatformModule(),
      new DataModule(user1, requiredInternalConfig(config)),
      new InteractorModule(),
    )
    // Initialize the evaluation interactor
    await component.evaluationInteractor().initialize()
  })

  afterEach(() => {
    destroyBKTClient()
    if (task) {
      task.stop()
      task = undefined
    }

    server.resetHandlers()

    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(() => {
    server.close()
  })

  test('start', async () => {
    let requestCount = 0
    server.use(
      http.post<
        Record<string, never>,
        GetEvaluationsRequest,
        GetEvaluationsResponse
      >(`${config.apiEndpoint}/get_evaluations`, () => {
        requestCount++
        return HttpResponse.json({
          evaluations: user1Evaluations,
          userEvaluationsId: 'user_evaluation_id_value',
        })
      }),
    )

    task = new EvaluationTask(component)
    task.start()

    await vi.runOnlyPendingTimersAsync()

    expect(requestCount).toBe(1)

    await vi.runOnlyPendingTimersAsync()

    expect(requestCount).toBe(2)

    await vi.runOnlyPendingTimersAsync()

    expect(requestCount).toBe(3)
  })

  test('start(true) fetches immediately and continues normal polling after', async () => {
    // Stubbed one level below EvaluationTask's own fetchEvaluations(), same as
    // StreamingTask.spec.ts does for EvaluationTask itself — this isolates the
    // start()/reschedule() scheduling behavior under test from real network
    // timing (in particular, postInternal's own abort/timeout timer, which
    // would otherwise become "pending" the instant start(true) synchronously
    // invokes fetchEvaluations(), unlike the timer-driven plain start()).
    const fetchInternal = vi
      .spyOn(BKTClientImpl, 'fetchEvaluationsInternal')
      .mockResolvedValue(undefined)

    task = new EvaluationTask(component)
    task.start(true)

    // Fired synchronously off of start(true) — no pollingInterval timer stands
    // between them, unlike plain start(). So a stream drop's polling fallback
    // doesn't leave users on stale evaluations for a full pollingInterval.
    expect(fetchInternal).toHaveBeenCalledTimes(1)

    // Let fetchEvaluations()'s own success path run reschedule() — the only
    // thing that arms the next poll timer, so there's never a second one.
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(config.pollingInterval)
    expect(fetchInternal).toHaveBeenCalledTimes(2)
  })

  test('stop() while a fetch is in flight does not reschedule afterward', async () => {
    let resolveFetch: () => void = () => {}
    vi.spyOn(BKTClientImpl, 'fetchEvaluationsInternal').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )

    task = new EvaluationTask(component)
    task.start(true) // fetch begins synchronously and is now in flight

    task.stop()
    expect(task.isRunning()).toBe(false)

    resolveFetch() // let the orphaned fetch resolve after stop()
    await Promise.resolve()
    await Promise.resolve()

    // The now-orphaned completion handler must not arm a new timer.
    expect(vi.getTimerCount()).toBe(0)
  })

  test('stop should cancel timer', async () => {
    let requestCount = 0
    server.use(
      http.post<
        Record<string, never>,
        GetEvaluationsRequest,
        GetEvaluationsResponse
      >(`${config.apiEndpoint}/get_evaluations`, () => {
        requestCount++
        return HttpResponse.json({
          evaluations: user1Evaluations,
          userEvaluationsId: 'user_evaluation_id_value',
        })
      }),
    )

    task = new EvaluationTask(component, 1_000 * 60, 5)
    task.start()

    expect(task.isRunning()).toBe(true)

    task.stop()

    await vi.advanceTimersToNextTimerAsync()
    await vi.advanceTimersToNextTimerAsync()

    expect(requestCount).toBe(0)
    expect(task.isRunning()).toBe(false)
  })

  suite('retry', () => {
    test('should back to normal interval after maxRetryCount', async () => {
      let requestCount = 0
      server.use(
        http.post(`${config.apiEndpoint}/get_evaluations`, () => {
          requestCount++
          return HttpResponse.error()
        }),
      )

      task = new EvaluationTask(component)
      task.start()

      const d0 = Date.now()

      await vi.runOnlyPendingTimersAsync()

      const d1 = Date.now()

      // initial fetch
      expect(d1 - d0).toBe(1_000 * 120)

      await vi.runOnlyPendingTimersAsync()

      const d2 = Date.now()

      // 1st retry
      expect(d2 - d1).toBe(1_000 * 60)

      await vi.runOnlyPendingTimersAsync()

      const d3 = Date.now()

      // 2nd retry
      expect(d3 - d2).toBe(1_000 * 60)

      await vi.runOnlyPendingTimersAsync()

      const d4 = Date.now()

      // 3rd retry
      expect(d4 - d3).toBe(1_000 * 60)

      await vi.runOnlyPendingTimersAsync()
      const d5 = Date.now()

      // 4th retry
      expect(d5 - d4).toBe(1_000 * 60)

      await vi.runOnlyPendingTimersAsync()
      const d6 = Date.now()

      // 5th retry
      expect(d6 - d5).toBe(1_000 * 60)

      await vi.runOnlyPendingTimersAsync()
      const d7 = Date.now()

      // back to normal
      expect(d7 - d6).toBe(1_000 * 120)

      expect(requestCount).toBe(7)
    })

    test('should back to normal interval after successful request', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json(null, { status: 500 })
          },
          { once: true },
        ),
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json(null, { status: 500 })
          },
          { once: true },
        ),
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, () => {
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
      )

      task = new EvaluationTask(component)
      task.start()

      const d0 = Date.now()

      await vi.runOnlyPendingTimersAsync()

      const d1 = Date.now()

      // initial fetch
      expect(d1 - d0).toBe(1_000 * 120)

      await vi.runOnlyPendingTimersAsync()

      const d2 = Date.now()

      // 1st retry
      expect(d2 - d1).toBe(1_000 * 60)

      await vi.runOnlyPendingTimersAsync()

      const d3 = Date.now()

      // 2nd retry(should be success)
      expect(d3 - d2).toBe(1_000 * 60)

      await vi.runOnlyPendingTimersAsync()

      const d4 = Date.now()

      // back to normal
      expect(d4 - d3).toBe(1_000 * 120)
    })

    test('should not retry when pollingInterval is short enough', async () => {
      let requestCount = 0
      server.use(
        http.post(`${config.apiEndpoint}/get_evaluations`, () => {
          requestCount++
          return HttpResponse.error()
        }),
      )

      const pollingInterval = 1_000 * 60 // 60 seconds the minimum polling interval, shorter than retry interval
      const retryInterval = 1_000 * 90 // 90 seconds
      const shortConfig = defineBKTConfig({
        apiKey: 'api_key_value',
        apiEndpoint: 'https://api.bucketeer.io',
        featureTag: 'feature_tag_value',
        appVersion: '1.2.3',
        eventsMaxQueueSize: 3,
        pollingInterval: pollingInterval,
        fetch,
      })

      const shortComponent = new DefaultComponent(
        new TestPlatformModule(),
        new DataModule(user1, requiredInternalConfig(shortConfig)),
        new InteractorModule(),
      )
      await shortComponent.evaluationInteractor().initialize()

      task = new EvaluationTask(shortComponent, retryInterval)
      task.start()

      const d0 = Date.now()

      await vi.runOnlyPendingTimersAsync()

      const d1 = Date.now()

      // Initial fetch
      expect(d1 - d0).toBe(pollingInterval)
      expect(requestCount).toBe(1)

      await vi.runOnlyPendingTimersAsync()

      const d2 = Date.now()

      // Next normal polling, no retries in between
      expect(d2 - d1).toBe(pollingInterval)
      expect(requestCount).toBe(2)

      // Next normal polling, no retries in between
      await vi.runOnlyPendingTimersAsync()

      const d3 = Date.now()

      expect(d3 - d2).toBe(pollingInterval)
      expect(requestCount).toBe(3)
    })

    test('should continue scheduling after error when pollingInterval <= retryInterval', async () => {
      let requestCount = 0
      server.use(
        http.post(`${config.apiEndpoint}/get_evaluations`, () => {
          requestCount++
          return HttpResponse.error()
        }),
      )

      const pollingInterval = 1_000 * 60 // 1 minute
      const retryInterval = 1_000 * 60 // 1 minute (equal to polling interval)
      const bugConfig = defineBKTConfig({
        apiKey: 'api_key_value',
        apiEndpoint: 'https://api.bucketeer.io',
        featureTag: 'feature_tag_value',
        appVersion: '1.2.3',
        eventsMaxQueueSize: 3,
        pollingInterval: pollingInterval,
        fetch,
      })

      const bugComponent = new DefaultComponent(
        new TestPlatformModule(),
        new DataModule(user1, requiredInternalConfig(bugConfig)),
        new InteractorModule(),
      )
      await bugComponent.evaluationInteractor().initialize()

      task = new EvaluationTask(bugComponent, retryInterval)
      task.start()

      await vi.runOnlyPendingTimersAsync()
      expect(requestCount).toBe(1)

      // Should continue scheduling even after error
      const pendingTimers = vi.getTimerCount()
      expect(pendingTimers).toBe(1) // Should have next timer scheduled

      await vi.runOnlyPendingTimersAsync()
      expect(requestCount).toBe(2) // Should continue fetching

      await vi.runOnlyPendingTimersAsync()
      expect(requestCount).toBe(3) // Should continue fetching
    })

    test('should continue scheduling after success when retryCount is 0', async () => {
      let requestCount = 0
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, () => {
          requestCount++
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
      )

      task = new EvaluationTask(component)
      task.start()

      await vi.runOnlyPendingTimersAsync()
      expect(requestCount).toBe(1)

      // Should continue scheduling after successful fetch
      const pendingTimers = vi.getTimerCount()
      expect(pendingTimers).toBe(1) // Should have next timer scheduled

      await vi.runOnlyPendingTimersAsync()
      expect(requestCount).toBe(2) // Should continue fetching

      await vi.runOnlyPendingTimersAsync()
      expect(requestCount).toBe(3) // Should continue fetching
    })
  })

  suite('sync status', () => {
    const respondWith500 = () => {
      server.use(
        http.post(`${config.apiEndpoint}/get_evaluations`, () =>
          HttpResponse.json(
            { error: { code: 500, message: 'request failed' } },
            { status: 500 },
          ),
        ),
      )
    }

    // pollingInterval 60 s is not longer than the retry interval, so the task
    // never retries: every failed poll ends its retries.
    const noRetryComponent = async (): Promise<DefaultComponent> => {
      const noRetryConfig = defineBKTConfig({
        apiKey: 'api_key_value',
        apiEndpoint: 'https://api.bucketeer.io',
        featureTag: 'feature_tag_value',
        appVersion: '1.2.3',
        pollingInterval: 1_000 * 60,
        fetch,
      })
      const noRetry = new DefaultComponent(
        new TestPlatformModule(),
        new DataModule(user1, requiredInternalConfig(noRetryConfig)),
        new InteractorModule(),
      )
      await noRetry.evaluationInteractor().initialize()
      return noRetry
    }

    const respondWith200 = () => {
      server.use(
        http.post(`${config.apiEndpoint}/get_evaluations`, () =>
          HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          }),
        ),
      )
    }

    test('a successful poll sets SYNCED with one listener call', async () => {
      respondWith200()
      const tracker = component.evaluationSyncStatusTracker()
      const listener = vi.fn()
      tracker.addListener(listener)
      task = new EvaluationTask(component)
      task.start(true)

      await vi.advanceTimersByTimeAsync(0)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(tracker.getStatus().state).toBe('SYNCED')
      expect(tracker.getStatus().lastSyncedAt).not.toBeNull()
    })

    // The server answered: the values it sent are not newer than the cache,
    // but the sync itself worked.
    test('a successful poll whose storage write is skipped as stale still sets SYNCED', async () => {
      respondWith200()
      vi.spyOn(
        component.dataModule.evaluationStorage(),
        'update',
      ).mockResolvedValue({ type: 'skippedStale' })
      task = new EvaluationTask(component)
      task.start(true)

      await vi.advanceTimersByTimeAsync(0)

      expect(component.evaluationSyncStatusTracker().getStatus().state).toBe(
        'SYNCED',
      )
    })

    // The success is reported only after the poll finishes, storage write
    // included. A write that throws ends the poll as a failed try: with no
    // retries left, it is reported as a polling failure.
    test('a storage write error after a successful poll does not set SYNCED, and is reported as a polling failure', async () => {
      respondWith200()
      const noRetry = await noRetryComponent()
      vi.spyOn(
        noRetry.dataModule.evaluationStorage(),
        'update',
      ).mockRejectedValue(new Error('storage failed'))
      task = new EvaluationTask(noRetry)
      task.start(true)

      await vi.advanceTimersByTimeAsync(0)

      const status = noRetry.evaluationSyncStatusTracker().getStatus()
      expect(status.state).toBe('FAILING')
      expect(status.lastSyncedAt).toBeNull()
      expect(status.lastError?.cause).toStrictEqual(
        new IllegalStateException('failed when polling: storage failed'),
      )
    })

    test('a failed poll is reported only when the retries are used up', async () => {
      respondWith500()
      const tracker = component.evaluationSyncStatusTracker()
      const listener = vi.fn()
      tracker.addListener(listener)
      task = new EvaluationTask(component)
      task.start()

      // The first poll and the first 4 retries fail: a retry is still left.
      for (let i = 0; i < 5; i++) {
        await vi.runOnlyPendingTimersAsync()
      }
      expect(listener).not.toHaveBeenCalled()
      expect(tracker.getStatus().lastError).toBeNull()

      // The 5th retry fails: no retry is left.
      await vi.runOnlyPendingTimersAsync()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(tracker.getStatus().lastError?.cause).toBeInstanceOf(
        InternalServerErrorException,
      )
    })

    test('with no retries, every failed poll is reported', async () => {
      respondWith500()
      const noRetry = await noRetryComponent()
      const listener = vi.fn()
      noRetry.evaluationSyncStatusTracker().addListener(listener)
      task = new EvaluationTask(noRetry)
      task.start()

      await vi.runOnlyPendingTimersAsync()
      expect(listener).toHaveBeenCalledTimes(1)

      await vi.runOnlyPendingTimersAsync()
      expect(listener).toHaveBeenCalledTimes(2)
    })

    test('a failed poll with no retry left moves INITIALIZING to FAILING', async () => {
      respondWith500()
      const noRetry = await noRetryComponent()
      const tracker = noRetry.evaluationSyncStatusTracker()
      task = new EvaluationTask(noRetry)
      task.start()

      await vi.runOnlyPendingTimersAsync()

      expect(tracker.getStatus().state).toBe('FAILING')
    })

    test('an error that is not an SDK exception is wrapped as IllegalStateException', async () => {
      const noRetry = await noRetryComponent()
      vi.spyOn(BKTClientImpl, 'fetchEvaluationsInternal').mockRejectedValue(
        new Error('storage failed'),
      )
      task = new EvaluationTask(noRetry)
      task.start(true)

      await vi.advanceTimersByTimeAsync(0)

      expect(
        noRetry.evaluationSyncStatusTracker().getStatus().lastError?.cause,
      ).toStrictEqual(
        new IllegalStateException('failed when polling: storage failed'),
      )
    })

    test('a listener that destroys the client on a failed poll leaves no next poll', async () => {
      let requests = 0
      server.use(
        http.post(`${config.apiEndpoint}/get_evaluations`, () => {
          requests++
          return HttpResponse.json(
            { error: { code: 500, message: 'request failed' } },
            { status: 500 },
          )
        }),
      )
      const noRetry = await noRetryComponent()
      task = new EvaluationTask(noRetry)
      // destroyBKTClient() stops the task in the same way.
      noRetry.evaluationSyncStatusTracker().addListener(() => task?.stop())
      task.start(true)
      await vi.advanceTimersByTimeAsync(0)

      await vi.advanceTimersByTimeAsync(60_000)

      expect(requests).toBe(1)
    })

    test('a listener that destroys the client on a successful poll leaves no next poll', async () => {
      let requests = 0
      server.use(
        http.post(`${config.apiEndpoint}/get_evaluations`, () => {
          requests++
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
      )
      task = new EvaluationTask(component)
      // destroyBKTClient() stops the task in the same way.
      component.evaluationSyncStatusTracker().addListener(() => task?.stop())
      task.start(true)
      await vi.advanceTimersByTimeAsync(0)

      await vi.advanceTimersByTimeAsync(config.pollingInterval)

      expect(requests).toBe(1)
    })

    test('a poll that fails after stop() reports nothing', async () => {
      const noRetry = await noRetryComponent()
      let rejectFetch: (error: unknown) => void = () => {}
      vi.spyOn(BKTClientImpl, 'fetchEvaluationsInternal').mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectFetch = reject
          }),
      )
      const listener = vi.fn()
      noRetry.evaluationSyncStatusTracker().addListener(listener)
      task = new EvaluationTask(noRetry)
      task.start(true)

      task.stop()
      rejectFetch(new InternalServerErrorException('Internal Server Error'))
      await vi.advanceTimersByTimeAsync(0)

      expect(listener).not.toHaveBeenCalled()
    })

    test('a poll that succeeds after stop() reports nothing', async () => {
      let resolveFetch: () => void = () => {}
      vi.spyOn(BKTClientImpl, 'fetchEvaluationsInternal').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveFetch = resolve
          }),
      )
      const listener = vi.fn()
      component.evaluationSyncStatusTracker().addListener(listener)
      task = new EvaluationTask(component)
      task.start(true)

      task.stop()
      resolveFetch()
      await vi.advanceTimersByTimeAsync(0)

      expect(listener).not.toHaveBeenCalled()
    })
  })
})

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

import { destroyBKTClient } from '../../../src/BKTClient'
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
      try {
        task.stop()
      } catch {
        // ignore
      }
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
    })
  })
})

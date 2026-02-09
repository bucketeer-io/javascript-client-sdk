import { http, HttpResponse } from 'msw'
import { SetupServer } from 'msw/node'
import {
  beforeEach,
  afterEach,
  expect,
  suite,
  test,
  vi,
  beforeAll,
  afterAll,
  describe,
} from 'vitest'

import { destroyBKTClient } from '../../../src/BKTClient'
import { BKTConfig, defineBKTConfig } from '../../../src/BKTConfig'
import { DefaultComponent } from '../../../src/internal/di/Component'
import { DataModule } from '../../../src/internal/di/DataModule'
import { RegisterEventsRequest } from '../../../src/internal/model/request/RegisterEventsRequest'
import { RegisterEventsResponse } from '../../../src/internal/model/response/RegisterEventsResponse'
import { EventTask } from '../../../src/internal/scheduler/EventTask'
import { TestPlatformModule, setupServerAndListen } from '../../utils'
import { InteractorModule } from '../../../src/internal/di/InteractorModule'
import { user1 } from '../../mocks/users'
import { requiredInternalConfig } from '../../../src/internal/InternalConfig'
import { ApiId } from '../../../src/internal/model/MetricsEventData'

suite('internal/scheduler/EventTask', () => {
  let server: SetupServer
  let config: BKTConfig
  let component: DefaultComponent
  let task: EventTask

  beforeAll(() => {
    server = setupServerAndListen()
  })

  beforeEach(() => {
    vi.useFakeTimers()

    config = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value',
      appVersion: '1.2.3',
      eventsMaxQueueSize: 3,
      eventsFlushInterval: 1000,
      fetch,
    })

    component = new DefaultComponent(
      new TestPlatformModule(),
      new DataModule(user1, requiredInternalConfig(config)),
      new InteractorModule(),
    )
  })

  afterEach(() => {
    destroyBKTClient()
    server.resetHandlers()
    task.stop()

    vi.useRealTimers()
  })

  afterAll(() => {
    server.close()
  })

  test('start', async () => {
    let requestCount = 0
    server.use(
      http.post<
        Record<string, never>,
        RegisterEventsRequest,
        RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
        requestCount++
        return HttpResponse.json({})
      }),
    )

    task = new EventTask(component)

    task.start()

    component
      .eventInteractor()
      .trackDefaultEvaluationEvent(
        'feature_tag_value',
        user1,
        'variation_id_value',
        'ERROR_FLAG_NOT_FOUND',
      )

    expect(requestCount).toBe(0)

    await vi.runOnlyPendingTimersAsync()

    expect(requestCount).toBe(1)
    expect(task.isRunning()).toBe(true)
  })

  test('send via eventUpdateListener', async () => {
    let requestCount = 0

    server.use(
      http.post<
        Record<string, never>,
        RegisterEventsRequest,
        RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
        requestCount++
        return HttpResponse.json({})
      }),
    )

    task = new EventTask(component)

    task.start()

    const interactor = component.eventInteractor()
    // 1 event
    await interactor.trackGoalEvent('feature_tag_value', user1, 'goal_id_value', 0.4)
    // 2 events
    await interactor.trackSuccess(ApiId.GET_EVALUATIONS, 'feature_tag_value', 1,1)

    expect(requestCount).toBe(0)

    await vi.advanceTimersToNextTimerAsync()

    expect(requestCount).toBe(1)
    expect(task.isRunning()).toBe(true)
  })

  test('stop should cancel timer', async () => {
    describe('start', async () => {
      let requestCount = 0
      server.use(
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          requestCount++
        return HttpResponse.json({})
        }),
      )

      task = new EventTask(component)

      task.start()

      component
        .eventInteractor()
        .trackDefaultEvaluationEvent(
          'feature_tag_value',
          user1,
          'variation_id_value',
          'ERROR_FLAG_NOT_FOUND',
        )

      task.stop()

      expect(requestCount).toBe(0)

      await vi.runOnlyPendingTimersAsync()

      expect(requestCount).toBe(0)
      expect(task.isRunning()).toBe(false)
    })
  })
})

import assert from 'assert'
import { HttpResponse, http } from 'msw'
import { SetupServer } from 'msw/node'

import {
  expect,
  suite,
  test,
  beforeEach,
  afterEach,
  vi,
  beforeAll,
  afterAll,
} from 'vitest'
import { BKTConfig, defineBKTConfig } from '../../../src/BKTConfig'
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NetworkException,
  RedirectRequestException,
  TimeoutException,
  UnauthorizedException,
  UnknownException,
} from '../../../src/BKTExceptions'
import { DefaultComponent } from '../../../src/internal/di/Component'
import { DataModule } from '../../../src/internal/di/DataModule'
import { InteractorModule } from '../../../src/internal/di/InteractorModule'
import { EventInteractor } from '../../../src/internal/event/EventInteractor'
import { EventStorageImpl } from '../../../src/internal/event/EventStorage'
import {
  Event,
  EventType,
  MetricsEvent,
  RootEventType,
} from '../../../src/internal/model/Event'
import {
  ApiId,
  MetricsEventType,
} from '../../../src/internal/model/MetricsEventData'
import { RegisterEventsRequest } from '../../../src/internal/model/request/RegisterEventsRequest'
import { RegisterEventsResponse } from '../../../src/internal/model/response/RegisterEventsResponse'
import { SourceId } from '../../../src/internal/model/SDKSourceId'
import { evaluation1 } from '../../mocks/evaluations'
import { user1 } from '../../mocks/users'
import {
  FakeClock,
  FakeIdGenerator,
  TestPlatformModule,
  setupServerAndListen,
} from '../../utils'
import { ErrorResponse } from '../../../src/internal/model/response/ErrorResponse'
import { Clock } from '../../../src/internal/Clock'
import { SDK_VERSION } from '../../../src/internal/version'
import { createInternalConfig, InternalConfig } from '../../../src/internal/InternalConfig'

class TestDataModule extends DataModule {
  clock(): Clock {
    if (!this._clock) {
      this._clock = new FakeClock()
    }
    return this._clock
  }
}

suite('internal/event/EventInteractor', () => {
  let server: SetupServer
  let config: BKTConfig
  let internalConfig: InternalConfig
  let component: DefaultComponent
  let interactor: EventInteractor
  let eventStorage: EventStorageImpl
  let clock: FakeClock
  let idGenerator: FakeIdGenerator

  beforeAll(() => {
    server = setupServerAndListen()
  })

  beforeEach(() => {
    config = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value',
      appVersion: '1.2.3',
      eventsMaxQueueSize: 3,
      userAgent: 'user_agent_value',
      fetch,
    })
    internalConfig = createInternalConfig(config)
    component = new DefaultComponent(
      new TestPlatformModule(),
      new TestDataModule(user1, internalConfig),
      new InteractorModule(),
    )

    interactor = component.eventInteractor()
    eventStorage = component.dataModule.eventStorage() as EventStorageImpl

    clock = component.dataModule.clock() as FakeClock
    idGenerator = component.platformModule.idGenerator() as FakeIdGenerator
  })

  afterEach(() => {
    server.resetHandlers()
    eventStorage.clear()
  })

  afterAll(() => {
    server.close()
  })

  test('trackEvaluationEvent', () => {
    const mockListener = vi.fn()
    interactor.setEventUpdateListener(mockListener)

    interactor.trackEvaluationEvent('feature_tag_value', user1, evaluation1)

    const expected: Event[] = [
      {
        id: idGenerator.calls[0],
        type: EventType.EVALUATION,
        event: {
          '@type': RootEventType.EvaluationEvent,
          timestamp: clock.currentTimeSecondsCalls[0],
          sourceId: SourceId.JAVASCRIPT,
          featureId: 'test-feature-1',
          featureVersion: 9,
          variationId: 'test-feature-1-variation-A',
          userId: user1.id,
          user: user1,
          metadata: {
            app_version: '1.2.3',
            device_model: 'user_agent_value',
          },
          reason: {
            type: 'CLIENT',
          },
          sdkVersion: SDK_VERSION,
          tag: 'feature_tag_value',
        },
      },
    ]

    expect(eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('trackDefaultEvaluationEvent', () => {
    const mockListener = vi.fn()
    interactor.setEventUpdateListener(mockListener)

    interactor.trackDefaultEvaluationEvent(
      'feature_tag_value',
      user1,
      'feature_id_value',
    )

    const expected: Event[] = [
      {
        id: idGenerator.calls[0],
        type: EventType.EVALUATION,
        event: {
          '@type': RootEventType.EvaluationEvent,
          timestamp: clock.currentTimeSecondsCalls[0],
          sourceId: SourceId.JAVASCRIPT,
          featureId: 'feature_id_value',
          featureVersion: 0,
          variationId: '',
          userId: user1.id,
          user: user1,
          metadata: {
            app_version: '1.2.3',
            device_model: 'user_agent_value',
          },
          reason: {
            type: 'CLIENT',
          },
          sdkVersion: SDK_VERSION,
          tag: 'feature_tag_value',
        },
      },
    ]

    expect(eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('trackGoalEvent', () => {
    const mockListener = vi.fn()
    interactor.setEventUpdateListener(mockListener)

    interactor.trackGoalEvent('feature_tag_value', user1, 'goal_id_value', 0.5)

    const expected: Event[] = [
      {
        id: idGenerator.calls[0],
        type: EventType.GOAL,
        event: {
          '@type': RootEventType.GoalEvent,
          timestamp: clock.currentTimeSecondsCalls[0],
          sourceId: SourceId.JAVASCRIPT,
          goalId: 'goal_id_value',
          value: 0.5,
          userId: user1.id,
          user: user1,
          metadata: {
            app_version: '1.2.3',
            device_model: 'user_agent_value',
          },
          sdkVersion: SDK_VERSION,
          tag: 'feature_tag_value',
        },
      },
    ]

    expect(eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('trackSuccess', () => {
    const mockListener = vi.fn()
    interactor.setEventUpdateListener(mockListener)

    interactor.trackSuccess(ApiId.GET_EVALUATION, 'feature_tag_value', 1, 723)

    const expected: Event[] = [
      {
        id: idGenerator.calls[0],
        type: EventType.METRICS,
        event: {
          '@type': RootEventType.MetricsEvent,
          timestamp: clock.currentTimeSecondsCalls[0],
          sourceId: SourceId.JAVASCRIPT,
          metadata: {
            app_version: '1.2.3',
            device_model: 'user_agent_value',
          },
          sdkVersion: SDK_VERSION,
          event: {
            apiId: ApiId.GET_EVALUATION,
            labels: { tag: 'feature_tag_value' },
            latencySecond: 1,
            '@type': MetricsEventType.LatencyMetrics,
          },
        },
      },
      {
        id: idGenerator.calls[1],
        type: EventType.METRICS,
        event: {
          '@type': RootEventType.MetricsEvent,
          timestamp: clock.currentTimeSecondsCalls[1],
          sourceId: SourceId.JAVASCRIPT,
          metadata: {
            app_version: '1.2.3',
            device_model: 'user_agent_value',
          },
          sdkVersion: SDK_VERSION,
          event: {
            apiId: ApiId.GET_EVALUATION,
            labels: { tag: 'feature_tag_value' },
            sizeByte: 723,
            '@type': MetricsEventType.SizeMetrics,
          },
        },
      },
    ]

    expect(eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test.each([
    {
      error: new RedirectRequestException(302, 'Redirect Request'),
      type: MetricsEventType.RedirectRequestError,
      extraLabels: { response_code: '302' },
    },
    {
      error: new BadRequestException(),
      type: MetricsEventType.BadRequestError,
    },
    {
      error: new UnknownException(
        'Unknown Error: 505 false, Some Random Message ,null',
        505,
      ),
      type: MetricsEventType.UnknownError,
      extraLabels: {
        response_code: '505',
        error_message: 'Unknown Error: 505 false, Some Random Message ,null',
      },
    },
    {
      error: new UnknownException('Unknown Error'),
      type: MetricsEventType.UnknownError,
      extraLabels: {
        error_message: 'Unknown Error',
      },
    },
    {
      error: new TimeoutException(1500),
      type: MetricsEventType.TimeoutError,
      extraLabels: { timeout: '1.5' },
    },
  ])('trackFailure: $errr -> type: $type', ({ error, type, extraLabels }) => {
    const mockListener = vi.fn()
    interactor.setEventUpdateListener(mockListener)

    interactor.trackFailure(ApiId.GET_EVALUATION, 'feature_tag_value', error)

    const expected = [
      {
        id: idGenerator.calls[0],
        type: EventType.METRICS,
        event: {
          '@type': RootEventType.MetricsEvent,
          timestamp: clock.currentTimeSecondsCalls[0],
          sourceId: SourceId.JAVASCRIPT,
          metadata: {
            app_version: '1.2.3',
            device_model: 'user_agent_value',
          },
          sdkVersion: SDK_VERSION,
          event: {
            apiId: ApiId.GET_EVALUATION,
            labels: { tag: 'feature_tag_value', ...extraLabels },
            '@type': type,
          },
        },
      },
    ]

    expect(eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('Do not save dupilicate MetricsEvents', () => {
    // trackSuccess saves two Events in each call
    // -> should save 4
    interactor.trackSuccess(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_1',
      1,
      723,
    )
    interactor.trackSuccess(
      ApiId.REGISTER_EVENTS,
      'feature_tag_value_1',
      1,
      724,
    )
    // this should be ignored
    interactor.trackSuccess(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_2',
      1,
      725,
    )

    // trackFailure saves one Event in each call
    interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value',
      new BadRequestException(),
    )
    interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_1',
      new NetworkException(),
    )
    interactor.trackFailure(
      ApiId.REGISTER_EVENTS,
      'feature_tag_value_1',
      new InternalServerErrorException(),
    )
    // this should be ignored
    interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_2',
      new BadRequestException(),
    )

    const events = eventStorage
      .getAll()
      .map((e) => interactor.getMetricsEventUniqueKey(e.event as MetricsEvent))

    expect(events).toStrictEqual([
      '2::type.googleapis.com/bucketeer.event.client.LatencyMetricsEvent',
      '2::type.googleapis.com/bucketeer.event.client.SizeMetricsEvent',
      '3::type.googleapis.com/bucketeer.event.client.LatencyMetricsEvent',
      '3::type.googleapis.com/bucketeer.event.client.SizeMetricsEvent',
      '2::type.googleapis.com/bucketeer.event.client.BadRequestErrorMetricsEvent',
      '2::type.googleapis.com/bucketeer.event.client.NetworkErrorMetricsEvent',
      '3::type.googleapis.com/bucketeer.event.client.InternalServerErrorMetricsEvent',
    ])
  })

  test('Skip generating error events for unauthorized or forbidden errors', () => {
    // trackFailure saves one Event in each call
    interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value',
      new UnauthorizedException(),
    )
    interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_1',
      new ForbiddenException(),
    )
    interactor.trackFailure(
      ApiId.REGISTER_EVENTS,
      'feature_tag_value_1',
      new InternalServerErrorException(),
    )

    const events = eventStorage
      .getAll()
      .map((e) => interactor.getMetricsEventUniqueKey(e.event as MetricsEvent))

    expect(events).toStrictEqual([
      '3::type.googleapis.com/bucketeer.event.client.InternalServerErrorMetricsEvent',
    ])
  })

  suite('sendEvents', () => {
    test('success', async () => {
      server.use(
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, async ({request}) => {
          const body = await request.json()
          expect(body.events).toHaveLength(3)
          expect(body.sourceId).toEqual(SourceId.JAVASCRIPT)
          expect(body.sdkVersion).toEqual(SDK_VERSION)
          return HttpResponse.json({errors: {}})
        }),
      )

      interactor.trackSuccess(ApiId.GET_EVALUATION, 'feature_tag_value', 1, 723)
      interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value',
        0.5,
      )
      interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value2',
        0.4,
      )

      expect(eventStorage.getAll()).toHaveLength(4)

      const result = await interactor.sendEvents()

      assert(result.type === 'success')

      expect(result.sent).toBe(true)

      const remainingEvents = eventStorage.getAll()

      expect(remainingEvents).toHaveLength(1)
      expect(remainingEvents[0].type).toBe(EventType.GOAL)
    })

    test('success - some events are failed', async () => {
      server.use(
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, async ({request}) => {
          const body = await request.json()
          expect(body.events).toHaveLength(3)
          return HttpResponse.json({
            errors: {
              [idGenerator.calls[0]]: {
                retriable: true,
                message: 'error',
              },
              [idGenerator.calls[2]]: {
                retriable: false,
                message: 'error',
              },
            },
          })
        }),
      )

      interactor.trackSuccess(ApiId.GET_EVALUATION, 'feature_tag_value', 1, 723)
      interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value',
        0.5,
      )

      expect(eventStorage.getAll()).toHaveLength(3)

      const result = await interactor.sendEvents()

      assert(result.type === 'success')

      expect(result.sent).toBe(true)

      const remainingEvents = eventStorage.getAll()

      // retriable error should be saved
      expect(remainingEvents).toHaveLength(1)
      expect(remainingEvents[0].type).toBe(EventType.METRICS)
    })

    test('failure', async () => {
      server.use(
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          ErrorResponse
        >(
          `${config.apiEndpoint}/register_events`,
          async () => {
            return HttpResponse.json({
              error: {
                code: 400,
                message: '400 error',
              },
              }, { status: 400 })
          },
        ),
      )

      interactor.trackSuccess(ApiId.GET_EVALUATION, 'feature_tag_value', 1, 723)
      interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value',
        0.5,
      )

      expect(eventStorage.getAll()).toHaveLength(3)

      const result = await interactor.sendEvents()

      assert(result.type === 'failure')

      expect(result.error).toBeInstanceOf(BadRequestException)

      // events should still exists in storage in case of failure
      expect(eventStorage.getAll()).toHaveLength(3)
    })

    test('current cache is less than `eventsMaxQueueSize`', async () => {
      interactor.trackSuccess(ApiId.GET_EVALUATION, 'feature_tag_value', 1, 723)

      expect(eventStorage.getAll()).toHaveLength(2)

      const result = await interactor.sendEvents()

      assert(result.type === 'success')

      expect(result.sent).toBe(false)

      expect(eventStorage.getAll()).toHaveLength(2)
    })

    test('force=true', async () => {
      server.use(
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, async ({request}) => {
          const body = await request.json()
          expect(body.events).toHaveLength(2)
          return HttpResponse.json({ errors: {} })
        }),
      )

      interactor.trackSuccess(ApiId.GET_EVALUATION, 'feature_tag_value', 1, 723)

      expect(eventStorage.getAll()).toHaveLength(2)

      const result = await interactor.sendEvents(/* force */ true)

      assert(result.type === 'success')

      // api request did not happen
      expect(result.sent).toBe(true)

      expect(eventStorage.getAll()).toHaveLength(0)
    })
  })
})

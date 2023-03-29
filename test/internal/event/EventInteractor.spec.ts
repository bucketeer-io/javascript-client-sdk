import assert from 'assert'
import { rest } from 'msw'
import { SetupServer } from 'msw/node'
import fetch from 'cross-fetch'
import { expect, suite, test, beforeEach, afterEach, vi } from 'vitest'
import { BKTConfig, defineBKTConfig } from '../../../src/BKTConfig'
import {
  BadRequestException,
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
  RootEventType,
} from '../../../src/internal/model/Event'
import {
  ApiId,
  MetricsEventType,
} from '../../../src/internal/model/MetricsEventData'
import { RegisterEventsRequest } from '../../../src/internal/model/request/RegisterEventsRequest'
import { RegisterEventsResponse } from '../../../src/internal/model/response/RegisterEventsResponse'
import { SourceID } from '../../../src/internal/model/SourceID'
import { evaluation1 } from '../../mocks/evaluations'
import { user1 } from '../../mocks/users'
import { FakeClock, FakeIdGenerator, setupServerAndListen } from '../../utils'
import { ErrorResponse } from '../../../src/internal/model/response/ErrorResponse'
import { IdGenerator } from '../../../src/internal/IdGenerator'
import { Clock } from '../../../src/internal/Clock'

class TestDataModule extends DataModule {
  idGenerator(): IdGenerator {
    if (!this._idGenerator) {
      this._idGenerator = new FakeIdGenerator()
    }
    return this._idGenerator
  }

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
  let component: DefaultComponent
  let interactor: EventInteractor
  let eventStorage: EventStorageImpl
  let clock: FakeClock
  let idGenerator: FakeIdGenerator

  beforeEach(() => {
    config = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value',
      appVersion: '1.2.3',
      eventsMaxBatchQueueCount: 3,
      userAgent: 'user_agent_value',
      fetch,
    })
    component = new DefaultComponent(
      new TestDataModule(user1, config),
      new InteractorModule(),
    )

    interactor = component.eventInteractor()
    eventStorage = component.dataModule.eventStorage() as EventStorageImpl

    clock = component.dataModule.clock() as FakeClock
    idGenerator = component.dataModule.idGenerator() as FakeIdGenerator
  })

  afterEach(() => {
    server?.close()
    eventStorage.clear()
  })

  test('trackEvaluationEvent', () => {
    const mockListener = vi.fn<[Event[]], void>()
    interactor.setEventUpdateListener(mockListener)

    interactor.trackEvaluationEvent('feature_tag_value', user1, evaluation1)

    const expected: Event[] = [
      {
        id: idGenerator.calls[0],
        type: EventType.EVALUATION,
        event: {
          '@type': RootEventType.EvaluationEvent,
          timestamp: clock.currentTimeSecondsCalls[0],
          sourceId: SourceID.JAVASCRIPT,
          featureId: 'test-feature-1',
          featureVersion: 9,
          variationId: 'test-feature-1-variation-A',
          userId: user1.id,
          user: user1,
          metadata: {
            appVersion: '1.2.3',
            deviceModel: 'user_agent_value',
          },
          reason: {
            type: 'CLIENT',
          },
          sdkVersion: '2.0.0',
          tag: 'feature_tag_value',
        },
      },
    ]

    expect(eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('trackDefaultEvaluationEvent', () => {
    const mockListener = vi.fn<[Event[]], void>()
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
          sourceId: SourceID.JAVASCRIPT,
          featureId: 'feature_id_value',
          featureVersion: 0,
          variationId: '',
          userId: user1.id,
          user: user1,
          metadata: {
            appVersion: '1.2.3',
            deviceModel: 'user_agent_value',
          },
          reason: {
            type: 'CLIENT',
          },
          sdkVersion: '2.0.0',
          tag: 'feature_tag_value',
        },
      },
    ]

    expect(eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('trackGoalEvent', () => {
    const mockListener = vi.fn<[Event[]], void>()
    interactor.setEventUpdateListener(mockListener)

    interactor.trackGoalEvent('feature_tag_value', user1, 'goal_id_value', 0.5)

    const expected: Event[] = [
      {
        id: idGenerator.calls[0],
        type: EventType.GOAL,
        event: {
          '@type': RootEventType.GoalEvent,
          timestamp: clock.currentTimeSecondsCalls[0],
          sourceId: SourceID.JAVASCRIPT,
          goalId: 'goal_id_value',
          value: 0.5,
          userId: user1.id,
          user: user1,
          metadata: {
            appVersion: '1.2.3',
            deviceModel: 'user_agent_value',
          },
          sdkVersion: '2.0.0',
          tag: 'feature_tag_value',
        },
      },
    ]

    expect(eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('trackSuccess', () => {
    const mockListener = vi.fn<[Event[]], void>()
    interactor.setEventUpdateListener(mockListener)

    interactor.trackSuccess(ApiId.GET_EVALUATION, 'feature_tag_value', 1, 723)

    const expected: Event[] = [
      {
        id: idGenerator.calls[0],
        type: EventType.METRICS,
        event: {
          '@type': RootEventType.MetricsEvent,
          timestamp: clock.currentTimeSecondsCalls[0],
          sourceId: SourceID.JAVASCRIPT,
          metadata: {
            appVersion: '1.2.3',
            deviceModel: 'user_agent_value',
          },
          sdkVersion: '2.0.0',
          event: {
            apiId: ApiId.GET_EVALUATION,
            labels: { tag: 'feature_tag_value' },
            latencySecond: { value: 1 },
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
          sourceId: SourceID.JAVASCRIPT,
          metadata: {
            appVersion: '1.2.3',
            deviceModel: 'user_agent_value',
          },
          sdkVersion: '2.0.0',
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
      error: new BadRequestException(),
      type: MetricsEventType.BadRequestError,
    },
    { error: new UnknownException(), type: MetricsEventType.UnknownError },
  ])('trackFailure: $errr -> type: $type', ({ error, type }) => {
    const mockListener = vi.fn<[Event[]], void>()
    interactor.setEventUpdateListener(mockListener)

    interactor.trackFailure(ApiId.GET_EVALUATION, 'feature_tag_value', error)

    const expected = [
      {
        id: idGenerator.calls[0],
        type: EventType.METRICS,
        event: {
          '@type': RootEventType.MetricsEvent,
          timestamp: clock.currentTimeSecondsCalls[0],
          sourceId: SourceID.JAVASCRIPT,
          metadata: {
            appVersion: '1.2.3',
            deviceModel: 'user_agent_value',
          },
          sdkVersion: '2.0.0',
          event: {
            apiId: ApiId.GET_EVALUATION,
            labels: { tag: 'feature_tag_value' },
            '@type': type,
          },
        },
      },
    ]

    expect(eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  suite('sendEvents', () => {
    test('success', async () => {
      server = setupServerAndListen(
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, async (req, res, ctx) => {
          const body = (await req.json()) as RegisterEventsRequest
          expect(body.events).toHaveLength(3)

          return res(
            ctx.status(200),
            ctx.json({
              errors: {},
            }),
          )
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
      server = setupServerAndListen(
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, async (req, res, ctx) => {
          const body = (await req.json()) as RegisterEventsRequest
          expect(body.events).toHaveLength(3)

          return res(
            ctx.status(200),
            ctx.json({
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
            }),
          )
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
      server = setupServerAndListen(
        rest.post<RegisterEventsRequest, Record<string, never>, ErrorResponse>(
          `${config.apiEndpoint}/register_events`,
          async (_req, res, ctx) => {
            return res(
              ctx.status(400),
              ctx.json<ErrorResponse>({
                error: {
                  code: 400,
                  message: '400 error',
                },
              }),
            )
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

    test('current cache is less than `eventsMaxBatchQueueCount`', async () => {
      interactor.trackSuccess(ApiId.GET_EVALUATION, 'feature_tag_value', 1, 723)

      expect(eventStorage.getAll()).toHaveLength(2)

      const result = await interactor.sendEvents()

      assert(result.type === 'success')

      expect(result.sent).toBe(false)

      expect(eventStorage.getAll()).toHaveLength(2)
    })

    test('force=true', async () => {
      server = setupServerAndListen(
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, async (req, res, ctx) => {
          const body = (await req.json()) as RegisterEventsRequest
          expect(body.events).toHaveLength(2)

          return res(
            ctx.status(200),
            ctx.json({
              errors: {},
            }),
          )
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

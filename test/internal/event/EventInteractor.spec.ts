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
import { SourceId } from '../../../src/internal/model/SourceId'
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
import {
  InternalConfig,
  requiredInternalConfig,
} from '../../../src/internal/InternalConfig'

class TestDataModule extends DataModule {
  clock(): Clock {
    return (this._clock ??= new FakeClock())
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
    internalConfig = requiredInternalConfig(config)
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

  test('trackEvaluationEvent', async () => {
    const mockListener = vi.fn()
    interactor.setEventUpdateListener(mockListener)

    await interactor.trackEvaluationEvent(
      'feature_tag_value',
      user1,
      evaluation1,
    )

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

    expect(await eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('trackDefaultEvaluationEvent', async () => {
    const mockListener = vi.fn()
    interactor.setEventUpdateListener(mockListener)

    await interactor.trackDefaultEvaluationEvent(
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

    expect(await eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('trackGoalEvent', async () => {
    const mockListener = vi.fn()
    interactor.setEventUpdateListener(mockListener)

    await interactor.trackGoalEvent(
      'feature_tag_value',
      user1,
      'goal_id_value',
      0.5,
    )

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

    expect(await eventStorage.getAll()).toEqual(expected)

    expect(mockListener).toHaveBeenCalledOnce()
    expect(mockListener).toHaveBeenCalledWith(expected)
  })

  test('trackSuccess', async () => {
    const mockListener = vi.fn()
    interactor.setEventUpdateListener(mockListener)

    await interactor.trackSuccess(
      ApiId.GET_EVALUATION,
      'feature_tag_value',
      1,
      723,
    )

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

    expect(await eventStorage.getAll()).toEqual(expected)

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
  ])(
    'trackFailure: $errr -> type: $type',
    async ({ error, type, extraLabels }) => {
      const mockListener = vi.fn()
      interactor.setEventUpdateListener(mockListener)

      await interactor.trackFailure(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        error,
      )

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
              labels: { ...extraLabels, tag: 'feature_tag_value' },
              '@type': type,
            },
          },
        },
      ]

      expect(await eventStorage.getAll()).toEqual(expected)

      expect(mockListener).toHaveBeenCalledOnce()
      expect(mockListener).toHaveBeenCalledWith(expected)
    },
  )

  test('Do not save dupilicate MetricsEvents', async () => {
    // trackSuccess saves two Events in each call
    // -> should save 4
    await interactor.trackSuccess(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_1',
      1,
      723,
    )
    await interactor.trackSuccess(
      ApiId.REGISTER_EVENTS,
      'feature_tag_value_1',
      1,
      724,
    )
    // this should be ignored
    await interactor.trackSuccess(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_2',
      1,
      725,
    )

    // trackFailure saves one Event in each call
    await interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value',
      new BadRequestException(),
    )
    await interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_1',
      new NetworkException(),
    )
    await interactor.trackFailure(
      ApiId.REGISTER_EVENTS,
      'feature_tag_value_1',
      new InternalServerErrorException(),
    )
    // this should be ignored
    await interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_2',
      new BadRequestException(),
    )

    const events = (await eventStorage.getAll()).map((e) =>
      interactor.getMetricsEventUniqueKey(e.event as MetricsEvent),
    )

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

  test('Skip generating error events for unauthorized or forbidden errors', async () => {
    // trackFailure saves one Event in each call
    await interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value',
      new UnauthorizedException(),
    )
    await interactor.trackFailure(
      ApiId.GET_EVALUATIONS,
      'feature_tag_value_1',
      new ForbiddenException(),
    )
    await interactor.trackFailure(
      ApiId.REGISTER_EVENTS,
      'feature_tag_value_1',
      new InternalServerErrorException(),
    )

    const events = (await eventStorage.getAll()).map((e) =>
      interactor.getMetricsEventUniqueKey(e.event as MetricsEvent),
    )

    expect(events).toStrictEqual([
      '3::type.googleapis.com/bucketeer.event.client.InternalServerErrorMetricsEvent',
    ])
  })

  suite('Evaluation Event Deduplication', () => {
    test('should deduplicate same evaluation within dedup window', async () => {
      // First evaluation - should create event
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(1)

      // Same evaluation within window - should be skipped
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(1)

      // Third call - should still be skipped
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(1)
    })

    test('should create new event after dedup window expires', async () => {
      // First evaluation at time 0
      clock.setCurrentTimeSeconds(1000)
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(1)

      // Same evaluation at time 0 + 29s (within 30s window) - should be skipped
      clock.setCurrentTimeSeconds(1029)
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(1)

      // Same evaluation at time 0 + 31s (outside 30s window) - should create new event
      clock.setCurrentTimeSeconds(1031)
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)
    })

    test('should create new event when variation changes', async () => {
      const evaluation2 = {
        ...evaluation1,
        variationId: 'test-feature-1-variation-B',
      }

      // First evaluation with variation A
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(1)

      // Same flag but variation B - should create new event
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation2,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)

      // Variation A again (within window) - should be skipped
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)

      // Variation B again (within window) - should be skipped
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation2,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)
    })

    test('should track different users separately', async () => {
      const user2 = { ...user1, id: 'user-id-2' }

      // User 1 evaluates flag
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(1)

      // User 2 evaluates same flag - should create new event
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user2,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)

      // User 1 again (within window) - should be skipped
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)

      // User 2 again (within window) - should be skipped
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user2,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)
    })

    test('should deduplicate default evaluations', async () => {
      // First default evaluation - should create event
      await interactor.trackDefaultEvaluationEvent(
        'feature_tag_value',
        user1,
        'feature_id_value',
      )
      expect(await eventStorage.getAll()).toHaveLength(1)

      // Same default evaluation (within window) - should be skipped
      await interactor.trackDefaultEvaluationEvent(
        'feature_tag_value',
        user1,
        'feature_id_value',
      )
      expect(await eventStorage.getAll()).toHaveLength(1)

      // After window expires - should create new event
      clock.setCurrentTimeSeconds(clock.currentTimeSeconds() + 31)
      await interactor.trackDefaultEvaluationEvent(
        'feature_tag_value',
        user1,
        'feature_id_value',
      )
      expect(await eventStorage.getAll()).toHaveLength(2)
    })

    test('should track different features separately', async () => {
      const evaluation2 = {
        ...evaluation1,
        featureId: 'test-feature-2',
        variationId: 'test-feature-2-variation-A',
      }

      // Evaluate feature 1
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(1)

      // Evaluate feature 2 - should create new event
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation2,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)

      // Feature 1 again (within window) - should be skipped
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation1,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)

      // Feature 2 again (within window) - should be skipped
      await interactor.trackEvaluationEvent(
        'feature_tag_value',
        user1,
        evaluation2,
      )
      expect(await eventStorage.getAll()).toHaveLength(2)
    })

    suite('Cache Cleanup Mechanism', () => {
      test('should cleanup stale cache entries after dedup window', async () => {
        // Start at time 1000
        clock.setCurrentTimeSeconds(1000)

        // Track 3 different evaluations
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )
        const evaluation2 = { ...evaluation1, variationId: 'variation-B' }
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation2,
        )
        const evaluation3 = { ...evaluation1, variationId: 'variation-C' }
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation3,
        )
        expect(await eventStorage.getAll()).toHaveLength(3)

        // Move time forward by dedup window (30 seconds)
        // At this point, all 3 cache entries should be stale
        clock.setCurrentTimeSeconds(1031)

        // Track a new evaluation - this should trigger cleanup
        const evaluation4 = { ...evaluation1, variationId: 'variation-D' }
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation4,
        )
        expect(await eventStorage.getAll()).toHaveLength(4)

        // Now track evaluation1 again - if cache was cleaned up, this should create a new event
        // If cache wasn't cleaned up, this would be skipped
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )
        expect(await eventStorage.getAll()).toHaveLength(5) // New event created = cache was cleaned
      })

      test('should not cleanup recent cache entries', async () => {
        // Start at time 1000
        clock.setCurrentTimeSeconds(1000)

        // Track first evaluation
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )
        expect(await eventStorage.getAll()).toHaveLength(1)

        // Move time forward by 15 seconds (still within 30s window)
        clock.setCurrentTimeSeconds(1015)

        // Track second evaluation - triggers cleanup check, but first entry is still fresh
        const evaluation2 = { ...evaluation1, variationId: 'variation-B' }
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation2,
        )
        expect(await eventStorage.getAll()).toHaveLength(2)

        // Track first evaluation again - should still be deduplicated (cache entry preserved)
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )
        expect(await eventStorage.getAll()).toHaveLength(2) // No new event = still cached
      })

      test('should only run cleanup once per dedup window', async () => {
        // Start at time 1000
        clock.setCurrentTimeSeconds(1000)

        // Track evaluation and create cache entry
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )

        // Move time forward by 5 seconds (not enough to trigger cleanup)
        clock.setCurrentTimeSeconds(1005)
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          { ...evaluation1, variationId: 'variation-B' },
        )

        // Move forward by another 5 seconds (still not enough)
        clock.setCurrentTimeSeconds(1010)
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          { ...evaluation1, variationId: 'variation-C' },
        )

        // Move forward to exactly 30 seconds from start (should trigger cleanup)
        clock.setCurrentTimeSeconds(1030)
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          { ...evaluation1, variationId: 'variation-D' },
        )

        // Move forward by 5 more seconds (cleanup shouldn't run again yet)
        clock.setCurrentTimeSeconds(1035)
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          { ...evaluation1, variationId: 'variation-E' },
        )

        // All evaluations should be tracked (5 events total)
        expect(await eventStorage.getAll()).toHaveLength(5)
      })

      test('should cleanup works correctly for default evaluations', async () => {
        // Start at time 1000
        clock.setCurrentTimeSeconds(1000)

        // Track default evaluation
        await interactor.trackDefaultEvaluationEvent(
          'feature_tag_value',
          user1,
          'feature-1',
        )
        expect(await eventStorage.getAll()).toHaveLength(1)

        // Within window - should be deduplicated
        clock.setCurrentTimeSeconds(1015)
        await interactor.trackDefaultEvaluationEvent(
          'feature_tag_value',
          user1,
          'feature-1',
        )
        expect(await eventStorage.getAll()).toHaveLength(1)

        // Move forward by dedup window + trigger cleanup
        clock.setCurrentTimeSeconds(1031)
        await interactor.trackDefaultEvaluationEvent(
          'feature_tag_value',
          user1,
          'feature-2',
        )

        // Track feature-1 again - cache should be cleaned, so new event created
        await interactor.trackDefaultEvaluationEvent(
          'feature_tag_value',
          user1,
          'feature-1',
        )
        expect(await eventStorage.getAll()).toHaveLength(3)
      })

      test('should handle mixed regular and default evaluations cleanup', async () => {
        // Start at time 1000
        clock.setCurrentTimeSeconds(1000)

        // Track both regular and default evaluations
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )
        await interactor.trackDefaultEvaluationEvent(
          'feature_tag_value',
          user1,
          'feature-default',
        )
        expect(await eventStorage.getAll()).toHaveLength(2)

        // Move forward and trigger cleanup
        clock.setCurrentTimeSeconds(1031)
        const evaluation2 = { ...evaluation1, variationId: 'variation-B' }
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation2,
        )

        // Both previous entries should be cleaned up
        // Track them again - should create new events
        await interactor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )
        await interactor.trackDefaultEvaluationEvent(
          'feature_tag_value',
          user1,
          'feature-default',
        )
        expect(await eventStorage.getAll()).toHaveLength(5)
      })
    })

    suite('Concurrent Call Handling', () => {
      test('should prevent duplicate events from concurrent calls', async () => {
        // Create a delayed storage to simulate real async behavior
        let addCallCount = 0
        const delayedStorage = {
          ...eventStorage,
          add: async (event: Event) => {
            addCallCount++
            // Simulate async delay that yields control to event loop
            await new Promise((resolve) => setTimeout(resolve, 10))
            return eventStorage.add(event)
          },
        }

        const delayedInteractor = new EventInteractor(
          config.eventsMaxQueueSize,
          component.dataModule.apiClient(),
          delayedStorage as unknown as EventStorageImpl,
          clock,
          idGenerator,
          config.appVersion,
          config.userAgent,
          internalConfig.sourceId,
          internalConfig.sdkVersion,
          config.evaluationDedupWindowMillis,
        )

        // Fire two concurrent calls without awaiting the first
        const promise1 = delayedInteractor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )
        const promise2 = delayedInteractor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )

        // Wait for both to complete
        await Promise.all([promise1, promise2])

        // Only ONE event should be created (second call was blocked by cache)
        expect(await eventStorage.getAll()).toHaveLength(1)
        // Only ONE storage.add() should have been called
        expect(addCallCount).toBe(1)
      })

      test('should handle concurrent default evaluation calls', async () => {
        let addCallCount = 0
        const delayedStorage = {
          ...eventStorage,
          add: async (event: Event) => {
            addCallCount++
            await new Promise((resolve) => setTimeout(resolve, 10))
            return eventStorage.add(event)
          },
        }

        const delayedInteractor = new EventInteractor(
          config.eventsMaxQueueSize,
          component.dataModule.apiClient(),
          delayedStorage as unknown as EventStorageImpl,
          clock,
          idGenerator,
          config.appVersion,
          config.userAgent,
          internalConfig.sourceId,
          internalConfig.sdkVersion,
          config.evaluationDedupWindowMillis,
        )

        // Fire concurrent default evaluation calls
        const promise1 = delayedInteractor.trackDefaultEvaluationEvent(
          'feature_tag_value',
          user1,
          'feature-1',
        )
        const promise2 = delayedInteractor.trackDefaultEvaluationEvent(
          'feature_tag_value',
          user1,
          'feature-1',
        )

        await Promise.all([promise1, promise2])

        // Only ONE event should be created
        expect(await eventStorage.getAll()).toHaveLength(1)
        expect(addCallCount).toBe(1)
      })

      test('should rollback cache on storage error', async () => {
        // Spy on console.error to verify error is logged
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation()

        // Create storage that throws error
        const errorStorage = {
          ...eventStorage,
          add: async () => {
            throw new Error('Storage error')
          },
        }

        const errorInteractor = new EventInteractor(
          config.eventsMaxQueueSize,
          component.dataModule.apiClient(),
          errorStorage as unknown as EventStorageImpl,
          clock,
          idGenerator,
          config.appVersion,
          config.userAgent,
          internalConfig.sourceId,
          internalConfig.sdkVersion,
          config.evaluationDedupWindowMillis,
        )

        // First call should fail gracefully (not throw) and log error
        await errorInteractor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )

        // Verify error was logged
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[Bucketeer] Failed to track evaluation event:',
          expect.any(Error),
        )

        consoleErrorSpy.mockRestore()

        // After rollback, the same call should be retried (not blocked by cache)
        // Use working storage for second attempt
        const workingInteractor = new EventInteractor(
          config.eventsMaxQueueSize,
          component.dataModule.apiClient(),
          eventStorage,
          clock,
          idGenerator,
          config.appVersion,
          config.userAgent,
          internalConfig.sourceId,
          internalConfig.sdkVersion,
          config.evaluationDedupWindowMillis,
        )

        // This should succeed because cache was rolled back
        await workingInteractor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )

        expect(await eventStorage.getAll()).toHaveLength(1)
      })

      test('should allow concurrent calls for different evaluations', async () => {
        const evaluation2 = { ...evaluation1, variationId: 'variation-B' }
        let addCallCount = 0

        const delayedStorage = {
          ...eventStorage,
          add: async (event: Event) => {
            addCallCount++
            await new Promise((resolve) => setTimeout(resolve, 10))
            return eventStorage.add(event)
          },
        }

        const delayedInteractor = new EventInteractor(
          config.eventsMaxQueueSize,
          component.dataModule.apiClient(),
          delayedStorage as unknown as EventStorageImpl,
          clock,
          idGenerator,
          config.appVersion,
          config.userAgent,
          internalConfig.sourceId,
          internalConfig.sdkVersion,
          config.evaluationDedupWindowMillis,
        )

        // Fire concurrent calls for DIFFERENT evaluations
        const promise1 = delayedInteractor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation1,
        )
        const promise2 = delayedInteractor.trackEvaluationEvent(
          'feature_tag_value',
          user1,
          evaluation2,
        )

        await Promise.all([promise1, promise2])

        // Both events should be created (different variations)
        expect(await eventStorage.getAll()).toHaveLength(2)
        expect(addCallCount).toBe(2)
      })
    })
  })

  suite('sendEvents', () => {
    test('success', async () => {
      server.use(
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, async ({ request }) => {
          const body = await request.json()
          expect(body.events).toHaveLength(3)
          expect(body.sourceId).toEqual(SourceId.JAVASCRIPT)
          expect(body.sdkVersion).toEqual(SDK_VERSION)
          return HttpResponse.json({ errors: {} })
        }),
      )

      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )
      await interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value',
        0.5,
      )
      await interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value2',
        0.4,
      )

      expect(await eventStorage.getAll()).toHaveLength(4)

      const result = await interactor.sendEvents()

      assert(result.type === 'success')

      expect(result.sent).toBe(true)

      const remainingEvents = await eventStorage.getAll()

      expect(remainingEvents).toHaveLength(1)
      expect(remainingEvents[0].type).toBe(EventType.GOAL)
    })

    test('success - some events are failed', async () => {
      server.use(
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, async ({ request }) => {
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

      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )
      await interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value',
        0.5,
      )

      expect(await eventStorage.getAll()).toHaveLength(3)

      const result = await interactor.sendEvents()

      assert(result.type === 'success')

      expect(result.sent).toBe(true)

      const remainingEvents = await eventStorage.getAll()

      // retriable error should be saved
      expect(remainingEvents).toHaveLength(1)
      expect(remainingEvents[0].type).toBe(EventType.METRICS)
    })

    test('failure', async () => {
      server.use(
        http.post<Record<string, never>, RegisterEventsRequest, ErrorResponse>(
          `${config.apiEndpoint}/register_events`,
          async () => {
            return HttpResponse.json(
              {
                error: {
                  code: 400,
                  message: '400 error',
                },
              },
              { status: 400 },
            )
          },
        ),
      )

      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )
      await interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value',
        0.5,
      )

      expect(await eventStorage.getAll()).toHaveLength(3)

      const result = await interactor.sendEvents()

      assert(result.type === 'failure')

      expect(result.error).toBeInstanceOf(BadRequestException)

      // events should still exists in storage in case of failure
      expect(await eventStorage.getAll()).toHaveLength(3)
    })

    test('current cache is less than `eventsMaxQueueSize`', async () => {
      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )

      expect(await eventStorage.getAll()).toHaveLength(2)

      const result = await interactor.sendEvents()

      assert(result.type === 'success')

      expect(result.sent).toBe(false)

      expect(await eventStorage.getAll()).toHaveLength(2)
    })

    test('force=true', async () => {
      server.use(
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, async ({ request }) => {
          const body = await request.json()
          expect(body.events).toHaveLength(2)
          return HttpResponse.json({ errors: {} })
        }),
      )

      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )

      expect(await eventStorage.getAll()).toHaveLength(2)

      const result = await interactor.sendEvents(/* force */ true)

      assert(result.type === 'success')

      // api request did not happen
      expect(result.sent).toBe(true)

      expect(await eventStorage.getAll()).toHaveLength(0)
    })
  })

  suite('only one register_event at a time to prevent sending duplicate events', async () => {
    test('concurrent send all events calls (forced = true)', async () => {
      let requestCount = 0
      server.use(
        http.post(`${config.apiEndpoint}/register_events`, async () => {
          requestCount++
          await new Promise((resolve) => setTimeout(resolve, 100))
          return HttpResponse.json({ errors: {} })
        }),
      )

      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )

      expect(await eventStorage.getAll()).toHaveLength(2)

      const p1 = interactor.sendEvents(true)
      const p2 = interactor.sendEvents(true)
      const p3 = interactor.sendEvents(true)

      const [r1, r2, r3] = await Promise.all([p1, p2, p3])

      assert(r1.type === 'success')
      assert(r2.type === 'success')
      assert(r3.type === 'success')

      expect(r1.sent).toBe(true)
      expect(r2.sent).toBe(false)
      expect(r3.sent).toBe(false)

      expect(requestCount).toBe(1)
      expect(await eventStorage.getAll()).toHaveLength(0)
    })

    test('concurrent send events calls (forced = false)', async () => {
      let requestCount = 0
      server.use(
        http.post(`${config.apiEndpoint}/register_events`, async () => {
          requestCount++
          await new Promise((resolve) => setTimeout(resolve, 100))
          return HttpResponse.json({ errors: {} })
        }),
      )

      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )
      await interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value',
        0.5,
      )

      expect(await eventStorage.getAll()).toHaveLength(3)

      const p1 = interactor.sendEvents(false)
      const p2 = interactor.sendEvents(false)
      const p3 = interactor.sendEvents(false)

      const [r1, r2, r3] = await Promise.all([p1, p2, p3])

      assert(r1.type === 'success')
      assert(r2.type === 'success')
      assert(r3.type === 'success')

      expect(r1.sent).toBe(true)
      expect(r2.sent).toBe(false)
      expect(r3.sent).toBe(false)

      expect(await eventStorage.getAll()).toHaveLength(0)
      expect(requestCount).toBe(1)
    })

    test('consecutive sendEvents calls', async () => {
      let requestCount = 0
      server.use(
        http.post(`${config.apiEndpoint}/register_events`, async () => {
          requestCount++
          return HttpResponse.json({ errors: {} })
        }),
      )

      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )

      expect(await eventStorage.getAll()).toHaveLength(2)

      const r1 = await interactor.sendEvents(true)

      assert(r1.type === 'success')
      expect(r1.sent).toBe(true)
      expect(requestCount).toBe(1)

      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )

      expect(await eventStorage.getAll()).toHaveLength(2)

      const r2 = await interactor.sendEvents(true)

      assert(r2.type === 'success')
      expect(r2.sent).toBe(true)
      expect(requestCount).toBe(2)
      expect(await eventStorage.getAll()).toHaveLength(0)
    })

    // This test verifies that the mutex lock covers the entire read -> send -> delete cycle.
    // If a new event is added while a send is in progress, the next send (which waits for the lock)
    // should see the clean state (old events deleted) and only send the new event.
    // This prevents duplicate events from being sent.
    test('new events added during sendEvents are sent in next call', async () => {
      const requests: RegisterEventsRequest[] = []
      server.use(
        http.post(`${config.apiEndpoint}/register_events`, async ({ request }) => {
          const body = (await request.json()) as RegisterEventsRequest
          requests.push(body)
          // Simulate a slow network request to ensure the first sendEvents is still running
          // when the second sendEvents is called.
          await new Promise((resolve) => setTimeout(resolve, 100))
          return HttpResponse.json({ errors: {} })
        }),
      )

      // 1. Track some initial events
      await interactor.trackSuccess(
        ApiId.GET_EVALUATION,
        'feature_tag_value',
        1,
        723,
      )

      expect(await eventStorage.getAll()).toHaveLength(2)

      // 2. Start the first sendEvents call. This will take at least 100ms.
      const p1 = interactor.sendEvents(true)

      // 3. Wait a bit to ensure the first request has started processing but hasn't finished.
      await new Promise((resolve) => setTimeout(resolve, 10))

      // 4. Track a new event while the first sendEvents is in progress.
      await interactor.trackGoalEvent(
        'feature_tag_value',
        user1,
        'goal_id_value',
        0.5,
      )

      // 5. Start the second sendEvents call.
      // Because of the mutex in EventInteractor, this should wait for p1 to complete.
      // It should then pick up the new event (GoalEvent) which was not included in p1.
      const p2 = interactor.sendEvents(true)

      const [r1, r2] = await Promise.all([p1, p2])

      assert(r1.type === 'success')
      assert(r2.type === 'success')

      expect(r1.sent).toBe(true)
      expect(r2.sent).toBe(true)

      expect(requests).toHaveLength(2)

      // The first request should contain the initial 2 metrics events
      expect(requests[0].events).toHaveLength(2)
      expect(
        requests[0].events.map((e) => {
          if (e.type === EventType.METRICS) {
            return e.event.event['@type']
          }
          return undefined
        }),
      ).toEqual(
        expect.arrayContaining([
          MetricsEventType.LatencyMetrics,
          MetricsEventType.SizeMetrics,
        ]),
      )

      // The second request should contain the new goal event
      expect(requests[1].events).toHaveLength(1)
      expect(requests[1].events[0].event['@type']).toBe(RootEventType.GoalEvent)

      expect(await eventStorage.getAll()).toHaveLength(0)
    })
  })
})

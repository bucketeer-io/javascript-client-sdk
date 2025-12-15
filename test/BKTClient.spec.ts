import { delay, http, HttpResponse } from 'msw'
import { SetupServer } from 'msw/node'
import assert from 'assert'
import {
  beforeEach,
  afterEach,
  expect,
  suite,
  test,
  beforeAll,
  afterAll,
  vi,
} from 'vitest'
import {
  defaultStringToTypeConverter,
  destroyBKTClient,
  getBKTClient,
  initializeBKTClientInternal,
  newDefaultBKTEvaluationDetails,
  stringToBoolConverter,
  stringToNumberConverter,
  stringToObjectConverter,
} from '../src/BKTClient'
import { BKTValue } from '../src/BKTValue'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { GetEvaluationsRequest } from '../src/internal/model/request/GetEvaluationsRequest'
import { GetEvaluationsResponse } from '../src/internal/model/response/GetEvaluationsResponse'
import { evaluation1, user1Evaluations } from './mocks/evaluations'
import {
  setupServerAndListen,
  getDefaultComponent,
  TestPlatformModule,
  FakeClock,
} from './utils'

import { user1 } from './mocks/users'
import {
  InternalServerErrorException,
  TimeoutException,
} from '../src/BKTExceptions'
import { Evaluation } from '../src/internal/model/Evaluation'
import { EventType, RootEventType } from '../src/internal/model/Event'
import { BKTEvaluation } from '../src/BKTEvaluation'
import { ErrorResponse } from '../src/internal/model/response/ErrorResponse'
import { RegisterEventsRequest } from '../src/internal/model/request/RegisterEventsRequest'
import { RegisterEventsResponse } from '../src/internal/model/response/RegisterEventsResponse'
import { DefaultComponent } from '../src/internal/di/Component'
import { DataModule } from '../src/internal/di/DataModule'
import { InteractorModule } from '../src/internal/di/InteractorModule'
import { BKTEvaluationDetails } from '../src/BKTEvaluationDetails'
import { requiredInternalConfig } from '../src/internal/InternalConfig'
import { SourceId } from '../src/internal/model/SourceId'

suite('BKTClient', () => {
  let server: SetupServer
  let config: BKTConfig
  let component: DefaultComponent
  let clock: FakeClock

  beforeAll(() => {
    server = setupServerAndListen()
  })

  beforeEach(() => {
    clock = new FakeClock()

    config = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value',
      appVersion: '1.2.3',
      eventsMaxQueueSize: 3,
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
  })

  afterAll(() => {
    server.close()
  })

  suite('initializeBKTClient', () => {
    test('first evaluation request succeeds', async () => {
      server.use(
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

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      const evaluationInteractor =
        getDefaultComponent(client).evaluationInteractor()

      const evaluation = evaluationInteractor.getLatest(
        user1Evaluations.evaluations[0].featureId,
      )

      expect(evaluation).toStrictEqual(user1Evaluations.evaluations[0])
    })

    test('first evaluation request timeouts', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          async () => {
            await delay(1000)
            return HttpResponse.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            })
          },
          { once: true },
        ),
      )

      await expect(async () => {
        await initializeBKTClientInternal(component, 500)
      }).rejects.toThrow(TimeoutException)

      const client = getBKTClient()

      assert(client !== null)

      const evaluationInteractor =
        getDefaultComponent(client).evaluationInteractor()

      const evaluation = evaluationInteractor.getLatest(
        user1Evaluations.evaluations[0].featureId,
      )

      expect(evaluation).toBeNull()
    })

    test('second call should immediately resolves without api request', async () => {
      server.use(
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
        // second initializeBKTClient will fail if there's a API request
        http.post(`${config.apiEndpoint}/get_evaluations`, () => {
          return HttpResponse.error()
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      await initializeBKTClientInternal(component, 1000)
    })
  })

  suite('getBKTClient', () => {
    test('returns null if not initialized', () => {
      expect(getBKTClient()).toBeNull()
    })
  })

  test('destroyBKtClient', async () => {
    server.use(
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

    await initializeBKTClientInternal(component, 1000)

    expect(getBKTClient()).not.toBeNull()

    destroyBKTClient()

    expect(getBKTClient()).toBeNull()
  })

  suite('stringVariation', () => {
    test.each([
      ['1', '', '1'],
      ['-1', '', '-1'],
      ['1.0', '', '1.0'],
      ['string', '', 'string'],
      ['true', '', 'true'],
      ['false', '', 'false'],
      ['{}', '', '{}'],
    ])(
      'value=%s, default=%s, actual=%s',
      async (value: string, defaultValue: string, actual: string) => {
        server.use(
          http.post<
            Record<string, never>,
            GetEvaluationsRequest,
            GetEvaluationsResponse
          >(`${config.apiEndpoint}/get_evaluations`, () => {
            return HttpResponse.json({
              evaluations: {
                ...user1Evaluations,
                evaluations: [buildEvaluation(value)],
              },
              userEvaluationsId: 'user_evaluation_id_value',
            })
          }),
          http.post<
            Record<string, never>,
            RegisterEventsRequest,
            RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, () => {
            return HttpResponse.json({})
          }),
        )

        await initializeBKTClientInternal(component, 1000)

        const client = getBKTClient()

        assert(client !== null)

        expect(client.stringVariation('feature_id_value', defaultValue)).toBe(
          actual,
        )
      },
    )

    test('returns default value if feature is not found', async () => {
      server.use(
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
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      expect(client.stringVariation('feature_id_value', 'default')).toBe(
        'default',
      )
    })
  })

  suite('numberVariation', () => {
    test.each([
      ['1', 0, 1],
      ['-1', 0, -1],
      ['1.0', 0, 1],
      ['1.0a', 0, 0],
      ['no int', 0, 0],
    ])(
      'value=%s, default=%s, actual=%s',
      async (value: string, defaultValue: number, actual: number) => {
        server.use(
          http.post<
            Record<string, never>,
            GetEvaluationsRequest,
            GetEvaluationsResponse
          >(
            `${config.apiEndpoint}/get_evaluations`,
            () => {
              return HttpResponse.json({
                evaluations: {
                  ...user1Evaluations,
                  evaluations: [buildEvaluation(value)],
                },
                userEvaluationsId: 'user_evaluation_id_value',
              })
            },
            { once: true },
          ),
          http.post<
            Record<string, never>,
            RegisterEventsRequest,
            RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, () => {
            return HttpResponse.json({})
          }),
        )

        await initializeBKTClientInternal(component, 1000)

        const client = getBKTClient()

        assert(client !== null)

        expect(client.numberVariation('feature_id_value', defaultValue)).toBe(
          actual,
        )
      },
    )

    test('returns default value if feature is not found', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            })
          },
          { once: true },
        ),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      expect(client.numberVariation('feature_id_value', 99)).toBe(99)
      expect(client.booleanVariation('feature_id_value', true)).toBe(true)
      expect(client.stringVariation('feature_id_value', '99')).toBe('99')
      expect(client.objectVariation('feature_id_value', 1)).toStrictEqual(1)
      expect(client.objectVariation('feature_id_value', true)).toStrictEqual(
        true,
      )
      expect(
        client.objectVariation('feature_id_value', 'default_text'),
      ).toStrictEqual('default_text')
      expect(
        client.objectVariation('feature_id_value', { k: 'v' }),
      ).toStrictEqual({ k: 'v' })
      expect(
        client.objectVariation('feature_id_value', [{ k: 'v' }]),
      ).toStrictEqual([{ k: 'v' }])
    })
  })

  suite('booleanVariation', () => {
    test.each([
      ['true', false, true],
      ['false', true, false],
      ['true', true, true],
      ['TRUE', false, true],
      ['truea', false, false],
      ['not bool', false, false],
      ['not bool', true, true],
      ['1', false, false],
      ['{}', false, false],
    ])(
      'value=%s, default=%s, actual=%s',
      async (value: string, defaultValue: boolean, actual: boolean) => {
        server.use(
          http.post<
            Record<string, never>,
            GetEvaluationsRequest,
            GetEvaluationsResponse
          >(
            `${config.apiEndpoint}/get_evaluations`,
            () => {
              return HttpResponse.json({
                evaluations: {
                  ...user1Evaluations,
                  evaluations: [buildEvaluation(value)],
                },
                userEvaluationsId: 'user_evaluation_id_value',
              })
            },
            { once: true },
          ),
          http.post<
            Record<string, never>,
            RegisterEventsRequest,
            RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, () => {
            return HttpResponse.json({})
          }),
        )

        await initializeBKTClientInternal(component, 1000)

        const client = getBKTClient()

        assert(client !== null)

        expect(client.booleanVariation('feature_id_value', defaultValue)).toBe(
          actual,
        )
      },
    )

    // cases for defaultValue is covered in the above test
  })

  suite('objectVariation', () => {
    const JSON_VALUE = '{"key": "value"}'

    test.each([
      [JSON_VALUE, {}, JSON.parse(JSON_VALUE)],
      ['true', JSON.parse(JSON_VALUE), JSON.parse(JSON_VALUE)],
      ['true', {}, {}],
      ['not bool', {}, {}],
      ['1', {}, {}],
      ['{}', {}, {}],
      ['[{"key": "value"}]', {}, [{ key: 'value' }]],
      ['', {}, {}],
      ['', 'default', 'default'],
      [' ', 1, 1],
      ['', true, true],
      ['true', {}, {}],
      ['1', 'default', 'default'],
      ['false', 1, 1],
      ['2', true, true],
    ])(
      'value=%s, default=%s, actual=%s',
      async (value, defaultValue, actual) => {
        server.use(
          http.post<
            Record<string, never>,
            GetEvaluationsRequest,
            GetEvaluationsResponse
          >(
            `${config.apiEndpoint}/get_evaluations`,
            () => {
              return HttpResponse.json({
                evaluations: {
                  ...user1Evaluations,
                  evaluations: [buildEvaluation(value)],
                },
                userEvaluationsId: 'user_evaluation_id_value',
              })
            },
            { once: true },
          ),
          http.post<
            Record<string, never>,
            RegisterEventsRequest,
            RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, () => {
            return HttpResponse.json({})
          }),
        )

        await initializeBKTClientInternal(component, 1000)

        const client = getBKTClient()

        assert(client !== null)

        expect(
          JSON.stringify(
            client.objectVariation('feature_id_value', defaultValue),
          ),
        ).toBe(JSON.stringify(actual))
      },
    )

    // cases for defaultValue is covered in the above test
  })

  suite('jsonVariation', () => {
    const JSON_VALUE = '{"key": "value"}'

    test.each([
      [JSON_VALUE, {}, JSON.parse(JSON_VALUE)],
      ['true', JSON.parse(JSON_VALUE), true],
      ['true', {}, true],
      ['not bool', {}, {}],
      ['1', {}, 1],
      ['{}', {}, {}],
    ])(
      'value=%s, default=%s, actual=%s',
      async (value, defaultValue, actual) => {
        server.use(
          http.post<
            Record<string, never>,
            GetEvaluationsRequest,
            GetEvaluationsResponse
          >(
            `${config.apiEndpoint}/get_evaluations`,
            () => {
              return HttpResponse.json({
                evaluations: {
                  ...user1Evaluations,
                  evaluations: [buildEvaluation(value)],
                },
                userEvaluationsId: 'user_evaluation_id_value',
              })
            },
            { once: true },
          ),
          http.post<
            Record<string, never>,
            RegisterEventsRequest,
            RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, () => {
            return HttpResponse.json({})
          }),
        )

        await initializeBKTClientInternal(component, 1000)

        const client = getBKTClient()

        assert(client !== null)

        expect(
          JSON.stringify(
            client.jsonVariation('feature_id_value', defaultValue),
          ),
        ).toBe(JSON.stringify(actual))
      },
    )
    // cases for defaultValue is covered in the above test
  })

  test('track', async () => {
    server.use(
      http.post<
        Record<string, never>,
        GetEvaluationsRequest,
        GetEvaluationsResponse
      >(
        `${config.apiEndpoint}/get_evaluations`,
        () => {
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        },
        { once: true },
      ),
      http.post<
        Record<string, never>,
        RegisterEventsRequest,
        RegisterEventsResponse
      >(`${config.apiEndpoint}/register_events`, () => {
        return HttpResponse.json({})
      }),
    )

    await initializeBKTClientInternal(component, 1000)

    const client = getBKTClient()

    assert(client !== null)

    await client.track('goal_id_value', 0.4)

    const storage = getDefaultComponent(client).dataModule.eventStorage()

    const lastEvent = (await storage.getAll()).at(-1)

    assert(lastEvent?.type === EventType.GOAL)

    expect(lastEvent.event.goalId).toBe('goal_id_value')
    expect(lastEvent.event.value).toBe(0.4)
  })

  test('track without await - like previous versions', async () => {
    server.use(
      http.post<
        Record<string, never>,
        GetEvaluationsRequest,
        GetEvaluationsResponse
      >(
        `${config.apiEndpoint}/get_evaluations`,
        () => {
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        },
        { once: true },
      ),
      http.post<
        Record<string, never>,
        RegisterEventsRequest,
        RegisterEventsResponse
      >(`${config.apiEndpoint}/register_events`, () => {
        return HttpResponse.json({})
      }),
    )

    await initializeBKTClientInternal(component, 1000)

    const client = getBKTClient()

    assert(client !== null)
    await client.flush()
    // Call track without await (fire and forget) like previous SDK versions
    client.track('goal_id_value', 0.4)

    // Give some time for the async operation to complete
    await new Promise((resolve) => setTimeout(resolve, 10))

    const storage = getDefaultComponent(client).dataModule.eventStorage()

    const allEvents = await storage.getAll()

    // Check that events exist
    expect(allEvents.length).toBeGreaterThan(0)

    // Find the GOAL event among all events
    const goalEvent = allEvents.find((event) => event.type === EventType.GOAL)

    // Assert that the GOAL event exists and has correct properties
    assert(goalEvent !== undefined)
    expect(goalEvent.event.goalId).toBe('goal_id_value')
    expect(goalEvent.event.value).toBe(0.4)
  })

  test('currentUser', async () => {
    server.use(
      http.post<
        Record<string, never>,
        GetEvaluationsRequest,
        GetEvaluationsResponse
      >(
        `${config.apiEndpoint}/get_evaluations`,
        () => {
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        },
        { once: true },
      ),
    )

    await initializeBKTClientInternal(component, 1000)

    const client = getBKTClient()

    assert(client !== null)

    expect(client.currentUser()).toStrictEqual({
      id: 'user_id_1',
      attributes: {
        age: '28',
      },
    })
  })

  test('updateUserAttributes', async () => {
    server.use(
      http.post<
        Record<string, never>,
        GetEvaluationsRequest,
        GetEvaluationsResponse
      >(
        `${config.apiEndpoint}/get_evaluations`,
        () => {
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        },
        { once: true },
      ),
      http.post<
        Record<string, never>,
        RegisterEventsRequest,
        RegisterEventsResponse
      >(`${config.apiEndpoint}/register_events`, () => {
        return HttpResponse.json({})
      }),
    )

    await initializeBKTClientInternal(component, 1000)

    const client = getBKTClient()

    assert(client !== null)

    const userHolder = getDefaultComponent(client).userHolder()
    const storage = getDefaultComponent(client).dataModule.evaluationStorage()

    expect(userHolder.get().data).toStrictEqual({ age: '28' })
    expect(await storage.getCurrentEvaluationsId()).toBe(
      'user_evaluation_id_value',
    )

    // 1. Update user attributes
    // Important: should unawaited
    client.updateUserAttributes({ key: 'value' })

    expect(userHolder.get().data).toStrictEqual({ key: 'value' })
    expect(await storage.getCurrentEvaluationsId()).toBe(
      'user_evaluation_id_value',
    )
    // 2. Even if we update user attributes without awaiting,
    // the storage is still updated, so getUserAttributesUpdated should return true.
    // because we are using mutex lock in setUserAttributesUpdated
    expect(await storage.getUserAttributesUpdated()).toBeTruthy()
  })

  suite('fetchEvaluations', async () => {
    test('success', async () => {
      const updatedEvaluation1 = {
        ...evaluation1,
        variationValue: 'updated_evaluation_value',
      } satisfies Evaluation

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json({
              evaluations: {
                id: 'user_evaluation_id_value',
                evaluations: [evaluation1],
                createdAt: clock.currentTimeMillis().toString(),
                forceUpdate: false,
                archivedFeatureIds: [],
              },
              userEvaluationsId: 'user_evaluation_id_value',
            })
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
            return HttpResponse.json({
              evaluations: {
                id: 'user_evaluation_id_value_updated',
                evaluations: [updatedEvaluation1],
                createdAt: clock.currentTimeMillis().toString(),
                forceUpdate: false,
                archivedFeatureIds: [],
              },
              userEvaluationsId: 'user_evaluation_id_value_updated',
            })
          },
          { once: true },
        ),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      const detail1 = client.evaluationDetails(evaluation1.featureId)
      expect(detail1?.variationId).toBe(evaluation1.variationId)
      expect(detail1?.variationValue).toBe(evaluation1.variationValue)

      await client.fetchEvaluations()

      const detail2 = client.evaluationDetails(evaluation1.featureId)
      expect(detail2?.variationId).toBe(updatedEvaluation1.variationId)
      expect(detail2?.variationValue).toBe(updatedEvaluation1.variationValue)
    })

    test('failure', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json({
              evaluations: {
                id: 'user_evaluation_id_value',
                evaluations: [evaluation1],
                createdAt: clock.currentTimeMillis().toString(),
                forceUpdate: false,
                archivedFeatureIds: [],
              },
              userEvaluationsId: 'user_evaluation_id_value',
            })
          },
          { once: true },
        ),
        http.post<Record<string, never>, GetEvaluationsRequest, ErrorResponse>(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json(
              {
                error: {
                  code: 500,
                  message: 'Internal Server Error',
                },
              },
              { status: 500 },
            )
          },
          { once: true },
        ),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      const detail1 = client.evaluationDetails(evaluation1.featureId)
      expect(detail1?.variationId).toBe(evaluation1.variationId)
      expect(detail1?.variationValue).toBe(evaluation1.variationValue)

      await expect(async () => client.fetchEvaluations()).rejects.toThrow(
        InternalServerErrorException,
      )

      // evaluation is not updated
      const detail2 = client.evaluationDetails(evaluation1.featureId)
      expect(detail2?.variationId).toBe(evaluation1.variationId)
      expect(detail2?.variationValue).toBe(evaluation1.variationValue)
    })
  })

  suite('flush', () => {
    test('success', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            })
          },
          { once: true },
        ),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(
          `${config.apiEndpoint}/register_events`,
          () => {
            return HttpResponse.json({})
          },
          { once: true },
        ),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      const eventStorage = getDefaultComponent(client).dataModule.eventStorage()

      expect((await eventStorage.getAll()).length).toBe(2)

      await client.flush()

      expect((await eventStorage.getAll()).length).toBe(0)
    })

    test('failure', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            })
          },
          { once: true },
        ),
        http.post<Record<string, never>, RegisterEventsRequest, ErrorResponse>(
          `${config.apiEndpoint}/register_events`,
          () => {
            return HttpResponse.json(
              {
                error: {
                  code: 500,
                  message: 'Internal Server Error',
                },
              },
              { status: 500 },
            )
          },
          { once: true },
        ),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      const eventStorage = getDefaultComponent(client).dataModule.eventStorage()

      expect((await eventStorage.getAll()).length).toBe(2)

      await expect(() => client.flush()).rejects.toThrow(
        InternalServerErrorException,
      )

      expect((await eventStorage.getAll()).length).toBe(2)
    })

    test('flushes all events across multiple batches', async () => {
      // Set up a config with a small eventsMaxQueueSize for testing
      const smallBatchConfig = defineBKTConfig({
        ...config,
        eventsMaxQueueSize: 3, // Small batch size to force multiple batches
      })

      const smallBatchComponent = new DefaultComponent(
        new TestPlatformModule(),
        new DataModule(
          { id: user1.id, data: user1.data },
          requiredInternalConfig(smallBatchConfig),
        ),
        new InteractorModule(),
      )

      let registerEventsCallCount = 0

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            })
          },
          { once: true },
        ),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, async ({ request }) => {
          registerEventsCallCount++
          const body =
            (await request.json()) as unknown as RegisterEventsRequest
          // Verify batch size doesn't exceed limit
          expect(body.events.length).toBeLessThanOrEqual(3)
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(smallBatchComponent, 1000)

      const client = getBKTClient()
      assert(client !== null)

      const eventStorage = getDefaultComponent(client).dataModule.eventStorage()

      // Initial events from initialization (2 metrics events)
      const initialEventCount = (await eventStorage.getAll()).length
      expect(initialEventCount).toBeGreaterThan(0)

      // Add more events to exceed one batch (3 events per batch)
      // Let's add 5 goal events, so total = initialEventCount + 5
      for (let i = 0; i < 5; i++) {
        // Simulate cached events
        // By prefilling the storage with goal events
        // if we use client.track(), it will automatically trigger register_events when reaching 
        // the batch size in the listener; that operation is not awaited and causes flaky tests
        await eventStorage.add({
          id: '5ea231b4-c3c7-4b9f-97a2-ee50337f51f' + i,
          type: EventType.GOAL,
          event: {
            timestamp: 1661780821,
            goalId: 'goal2',
            userId: user1.id,
            user: user1,
            value: 0.0,
            tag: 'javascript',
            sourceId: SourceId.JAVASCRIPT,
            sdkVersion: '1.0.0',
            metadata: {
              app_version: '1.2.3',
              os_version: 'os_version_value',
              device_model: 'device_model_value',
            },
            '@type': RootEventType.GoalEvent,
          },
        })
      }

      const totalEvents = (await eventStorage.getAll()).length
      expect(totalEvents).toBeGreaterThan(3) // Ensure we have more than one batch

      // Flush should send all events in multiple batches
      await client.flush()

      // Verify all events were sent
      expect((await eventStorage.getAll()).length).toBe(0)

      // Verify multiple API calls were made (ceiling of totalEvents / 3)
      const expectedCalls = Math.ceil(totalEvents / 3)
      expect(registerEventsCallCount).toBe(expectedCalls)
    })
  })

  suite('evaluationDetails', () => {
    test('return BKTEvaluation if target evaluation exists', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            })
          },
          { once: true },
        ),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      expect(
        client.evaluationDetails(evaluation1.featureId),
      ).toStrictEqual<BKTEvaluation>({
        id: evaluation1.id,
        featureId: evaluation1.featureId,
        featureVersion: evaluation1.featureVersion,
        userId: user1.id,
        reason: evaluation1.reason.type,
        variationId: evaluation1.variationId,
        variationName: evaluation1.variationName,
        variationValue: evaluation1.variationValue,
      })
    })

    test('return null if target evaluation does not exist', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(
          `${config.apiEndpoint}/get_evaluations`,
          () => {
            return HttpResponse.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            })
          },
          { once: true },
        ),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      expect(client.evaluationDetails('non_existent_feature_id')).toBeNull()
    })
  })

  suite('newDefaultBKTEvaluationDetails', () => {
    test.each([
      ['default true', true],
      ['default false', false],
    ])('value=%s, default=%s', (_value: string, defaultValue: boolean) => {
      const userId = '1'
      const featureId = 'featureId'
      const actualEvaluationDetails = newDefaultBKTEvaluationDetails(
        userId,
        featureId,
        defaultValue,
      )
      expect(actualEvaluationDetails).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: userId,
        variationId: '',
        variationName: '',
        variationValue: defaultValue,
        reason: 'CLIENT',
      })
    })

    test.each([
      ['default 1', 1],
      ['default 2.0', 2.0],
    ])('value=%s, default=%s', (_value: string, defaultValue: number) => {
      const userId = '1'
      const featureId = 'featureId'
      const actualEvaluationDetails = newDefaultBKTEvaluationDetails(
        userId,
        featureId,
        defaultValue,
      )
      expect(actualEvaluationDetails.variationValue).toBe(defaultValue)
      expect(actualEvaluationDetails).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: userId,
        variationId: '',
        variationName: '',
        variationValue: defaultValue,
        reason: 'CLIENT',
      })
    })

    test.each([
      ['default 1', '1'],
      ['default 2.0', '2.0'],
    ])('value=%s, default=%s', (_value: string, defaultValue: string) => {
      const userId = '1'
      const featureId = 'featureId'
      const actualEvaluationDetails = newDefaultBKTEvaluationDetails(
        userId,
        featureId,
        defaultValue,
      )
      expect(actualEvaluationDetails.variationValue).toBe(defaultValue)
      expect(actualEvaluationDetails).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: userId,
        variationId: '',
        variationName: '',
        variationValue: defaultValue,
        reason: 'CLIENT',
      })
    })

    test.each([
      ['default 1', '{"key": "value"}'],
      ['default 2.0', '{}'],
    ])('value=%s, default=%s', (_value: string, defaultValueString: string) => {
      const defaultValue = JSON.parse(defaultValueString)
      const userId = '1'
      const featureId = 'featureId'
      const actualEvaluationDetails = newDefaultBKTEvaluationDetails(
        userId,
        featureId,
        defaultValue,
      )
      expect(JSON.stringify(actualEvaluationDetails.variationValue)).toBe(
        JSON.stringify(defaultValue),
      )
      expect(actualEvaluationDetails).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: userId,
        variationId: '',
        variationName: '',
        variationValue: defaultValue,
        reason: 'CLIENT',
      })
    })
  })

  suite('RawValueTransformer', () => {
    test.each([
      ['default true', 'default'],
      ['default false', 'default'],
      ['', 'default'],
      [' ', 'default'],
      ['1', 'default'],
      ['12', 'default'],
      ['[]', 'default'],
    ])(
      'convertRawValueToType<string> value=%s, testValue=%s',
      (variationValue: string, _testValue: string) => {
        let result: string | null = null
        const transformer = defaultStringToTypeConverter
        result = transformer(variationValue)
        expect(result).toStrictEqual(variationValue)
      },
    )

    test.each([
      ['default true', null, true],
      ['default false', null, true],
      ['', null, true],
      [' ', null, true],
      ['1', null, true],
      ['12', null, true],
      ['1.0', null, true],
      ['12.0', null, true],
      ['true', true, true],
      ['false', false, true],
      ['[]', null, true],
      ['{}', null, true],
      ['{"key1": "value1"}', null, true],
    ])(
      'convertRawValueToType<boolean> value=%s, expected=%s, testValue=%s',
      (
        variationValue: string,
        expected: boolean | null,
        _testValue: boolean,
      ) => {
        let result: boolean | null = null
        try {
          const transformer = stringToBoolConverter
          result = transformer(variationValue)
          expect(result).toStrictEqual(expected)
        } catch {
          expect(expected).toStrictEqual(null)
        }
      },
    )

    test.each([
      ['default true', null, 1],
      ['default false', null, 1],
      ['', null, 1],
      [' ', null, 2],
      ['1', 1, 1],
      ['12', 12, 1],
      ['1.0', 1, 1],
      ['12.0', 12, 1],
      ['true', null, 1],
      ['false', null, 1],
      ['{}', null, 1],
      ['[]', null, 1],
      ['{"key1": "value1"}', null, 1],
    ])(
      'convertRawValueToType<number> value=%s, expected=%s, testValue=%s',
      (variationValue: string, expected: number | null, _testValue: number) => {
        let result: number | null = null
        try {
          const transformer = stringToNumberConverter
          result = transformer(variationValue)
          expect(result).toStrictEqual(expected)
        } catch {
          expect(expected).toStrictEqual(null)
        }
      },
    )

    test.each([
      ['default true', null, { key1: 'value1' }],
      ['default false', null, { key2: 'value1' }],
      ['', null, { key1: 'value12' }],
      [' ', null, { key1: 'value1222' }],
      ['1', null, {}],
      ['12', null, {}],
      ['1.0', null, {}],
      ['12.0', null, {}],
      [
        'true',
        null,
        { key222: 'value1', key122: 'value1333', key121: 'value13333' },
      ],
      ['false', null, {}],
      ['[]', [], { key133: 'value1' }],
      ['{}', {}, { key122: 'value1333', key121: 'value13333' }],
      [
        '{"key1": "value1"}',
        { key1: 'value1' },
        { key1: 'value1', key2: 'value1', key3: 'value1' },
      ],
      [
        JSON.stringify({ key1: 'value1', key2: 'value1', key3: 'value1' }),
        { key1: 'value1', key2: 'value1', key3: 'value1' },
        { key1: 'value1' },
      ],
    ])(
      'convertRawValueToType<object> value=%s, expected=%s, testValue=%s',
      (variationValue: string, expected: object | null, _testValue: object) => {
        let result: BKTValue | null = null
        try {
          const transformer = stringToObjectConverter
          result = transformer(variationValue)
          expect(result).toStrictEqual(expected)
        } catch {
          expect(expected).toStrictEqual(null)
        }
      },
    )
  })

  suite('BKTEvaluationDetails', () => {
    test('BKTEvaluationDetailsDefaultValue', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, () => {
          return HttpResponse.json({
            evaluations: {
              ...user1Evaluations,
              evaluations: [],
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()
      const userId = 'user_id_1'
      const featureId = 'feature_id_value'
      assert(client !== null)

      expect(
        client.stringVariationDetails(featureId, 'default1'),
      ).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, 'default1'),
      )

      expect(client.numberVariationDetails(featureId, 22)).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, 22.0),
      )

      expect(client.booleanVariationDetails(featureId, true)).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, true),
      )

      expect(client.booleanVariationDetails(featureId, false)).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, false),
      )

      expect(client.objectVariationDetails(featureId, true)).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, true),
      )

      expect(client.objectVariationDetails(featureId, 1)).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, 1),
      )

      expect(client.objectVariationDetails(featureId, 'true')).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, 'true'),
      )

      expect(
        client.objectVariationDetails(featureId, { key: 'value22' }),
      ).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, { key: 'value22' }),
      )

      expect(
        client.objectVariationDetails(featureId, { key: 'value' }),
      ).not.toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, { key: 'value22' }),
      )

      expect(client.objectVariationDetails(featureId, [])).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, []),
      )

      expect(
        client.objectVariationDetails(featureId, [{ key: 'value' }]),
      ).toStrictEqual(
        newDefaultBKTEvaluationDetails(userId, featureId, [{ key: 'value' }]),
      )
    })

    test('stringVariationDetails', async () => {
      const featureId = 'stringVariationDetails'
      const mockStringEvaluation = buildEvaluation('default', featureId)

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, () => {
          return HttpResponse.json({
            evaluations: {
              ...user1Evaluations,
              evaluations: [mockStringEvaluation],
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()
      assert(client !== null)
      expect(client.stringVariationDetails(featureId, '')).toStrictEqual({
        featureId: mockStringEvaluation.featureId,
        featureVersion: mockStringEvaluation.featureVersion,
        userId: mockStringEvaluation.userId,
        variationId: mockStringEvaluation.variationId,
        variationName: mockStringEvaluation.variationName,
        variationValue: mockStringEvaluation.variationValue,
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<string>)

      expect(client.numberVariationDetails(featureId, 1)).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: mockStringEvaluation.userId,
        variationId: '',
        variationName: '',
        variationValue: 1,
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<number>)

      expect(client.booleanVariationDetails(featureId, true)).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: mockStringEvaluation.userId,
        variationId: '',
        variationName: '',
        variationValue: true,
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<boolean>)

      expect(
        client.objectVariationDetails(featureId, { key: 'value11' }),
      ).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: mockStringEvaluation.userId,
        variationId: '',
        variationName: '',
        variationValue: { key: 'value11' },
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<BKTValue>)
    })

    test('numVariationDetails', async () => {
      const featureId = 'numVariationDetails'
      const mockStringEvaluation = buildEvaluation('1', featureId)

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, () => {
          return HttpResponse.json({
            evaluations: {
              ...user1Evaluations,
              evaluations: [mockStringEvaluation],
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()
      assert(client !== null)
      expect(client.numberVariationDetails(featureId, 2)).toStrictEqual({
        featureId: mockStringEvaluation.featureId,
        featureVersion: mockStringEvaluation.featureVersion,
        userId: mockStringEvaluation.userId,
        variationId: mockStringEvaluation.variationId,
        variationName: mockStringEvaluation.variationName,
        variationValue: 1,
        reason: mockStringEvaluation.reason.type,
      } satisfies BKTEvaluationDetails<number>)

      expect(client.stringVariationDetails(featureId, '')).toStrictEqual({
        featureId: featureId,
        featureVersion: mockStringEvaluation.featureVersion,
        userId: mockStringEvaluation.userId,
        variationId: mockStringEvaluation.variationId,
        variationName: mockStringEvaluation.variationName,
        variationValue: '1',
        reason: mockStringEvaluation.reason.type,
      } satisfies BKTEvaluationDetails<string>)

      expect(client.booleanVariationDetails(featureId, true)).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: mockStringEvaluation.userId,
        variationId: '',
        variationName: '',
        variationValue: true,
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<boolean>)

      expect(
        client.objectVariationDetails(featureId, { key: 'value11' }),
      ).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: mockStringEvaluation.userId,
        variationId: '',
        variationName: '',
        variationValue: { key: 'value11' },
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<BKTValue>)
    })

    test('booleanVariationDetails', async () => {
      const featureId = 'booleanVariationDetails'
      const mockStringEvaluation = buildEvaluation('true', featureId)

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, () => {
          return HttpResponse.json({
            evaluations: {
              ...user1Evaluations,
              evaluations: [mockStringEvaluation],
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()
      assert(client !== null)
      expect(client.booleanVariationDetails(featureId, false)).toStrictEqual({
        featureId: featureId,
        featureVersion: mockStringEvaluation.featureVersion,
        userId: mockStringEvaluation.userId,
        variationId: mockStringEvaluation.variationId,
        variationName: mockStringEvaluation.variationName,
        variationValue: true,
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<boolean>)

      expect(client.stringVariationDetails(featureId, '')).toStrictEqual({
        featureId: featureId,
        featureVersion: mockStringEvaluation.featureVersion,
        userId: mockStringEvaluation.userId,
        variationId: mockStringEvaluation.variationId,
        variationName: mockStringEvaluation.variationName,
        variationValue: 'true',
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<string>)

      expect(client.numberVariationDetails(featureId, 1)).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: mockStringEvaluation.userId,
        variationId: '',
        variationName: '',
        variationValue: 1,
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<number>)

      expect(
        client.objectVariationDetails(featureId, { key: 'value11' }),
      ).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: mockStringEvaluation.userId,
        variationId: '',
        variationName: '',
        variationValue: { key: 'value11' },
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<BKTValue>)
    })

    test('objectVariationDetails', async () => {
      const featureId = 'objectVariationDetails'
      const mockJsonObjectEvaluation = buildEvaluation(
        '{"key1": "value1"}',
        featureId,
      )

      const featureIdForJsonArray = 'objectVariationDetailsArray'
      const mockJsonArrayEvaluation = buildEvaluation(
        '[{"key1": "value1"}]',
        featureIdForJsonArray,
      )

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, () => {
          return HttpResponse.json({
            evaluations: {
              ...user1Evaluations,
              evaluations: [mockJsonObjectEvaluation, mockJsonArrayEvaluation],
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, () => {
          return HttpResponse.json({})
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()
      assert(client !== null)

      expect(
        client.objectVariationDetails(featureIdForJsonArray, {}),
      ).toStrictEqual({
        featureId: featureIdForJsonArray,
        featureVersion: mockJsonArrayEvaluation.featureVersion,
        userId: mockJsonArrayEvaluation.userId,
        variationId: mockJsonArrayEvaluation.variationId,
        variationName: mockJsonArrayEvaluation.variationName,
        variationValue: [{ key1: 'value1' }],
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<BKTValue>)

      expect(client.objectVariationDetails(featureId, {})).toStrictEqual({
        featureId: mockJsonObjectEvaluation.featureId,
        featureVersion: mockJsonObjectEvaluation.featureVersion,
        userId: mockJsonObjectEvaluation.userId,
        variationId: mockJsonObjectEvaluation.variationId,
        variationName: mockJsonObjectEvaluation.variationName,
        variationValue: { key1: 'value1' },
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<BKTValue>)

      expect(client.objectVariationDetails(featureId, '')).toStrictEqual({
        featureId: mockJsonObjectEvaluation.featureId,
        featureVersion: mockJsonObjectEvaluation.featureVersion,
        userId: mockJsonObjectEvaluation.userId,
        variationId: mockJsonObjectEvaluation.variationId,
        variationName: mockJsonObjectEvaluation.variationName,
        variationValue: { key1: 'value1' },
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<BKTValue>)

      expect(client.objectVariationDetails(featureId, true)).toStrictEqual({
        featureId: mockJsonObjectEvaluation.featureId,
        featureVersion: mockJsonObjectEvaluation.featureVersion,
        userId: mockJsonObjectEvaluation.userId,
        variationId: mockJsonObjectEvaluation.variationId,
        variationName: mockJsonObjectEvaluation.variationName,
        variationValue: { key1: 'value1' },
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<BKTValue>)

      expect(client.objectVariationDetails(featureId, 1)).toStrictEqual({
        featureId: mockJsonObjectEvaluation.featureId,
        featureVersion: mockJsonObjectEvaluation.featureVersion,
        userId: mockJsonObjectEvaluation.userId,
        variationId: mockJsonObjectEvaluation.variationId,
        variationName: mockJsonObjectEvaluation.variationName,
        variationValue: { key1: 'value1' },
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<BKTValue>)

      expect(client.stringVariationDetails(featureId, '')).toStrictEqual({
        featureId: featureId,
        featureVersion: mockJsonObjectEvaluation.featureVersion,
        userId: mockJsonObjectEvaluation.userId,
        variationId: mockJsonObjectEvaluation.variationId,
        variationName: mockJsonObjectEvaluation.variationName,
        variationValue: '{"key1": "value1"}',
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<string>)

      expect(client.numberVariationDetails(featureId, 1)).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: mockJsonObjectEvaluation.userId,
        variationId: '',
        variationName: '',
        variationValue: 1,
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<number>)

      expect(client.booleanVariationDetails(featureId, true)).toStrictEqual({
        featureId: featureId,
        featureVersion: 0,
        userId: mockJsonObjectEvaluation.userId,
        variationId: '',
        variationName: '',
        variationValue: true,
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetails<boolean>)
    })
  })

  suite('destroyBKTClient - integration', () => {
    test('should call clearPageLifecycleCleanup when destroying client', async () => {
      // Import and spy on clearPageLifecycleCleanup
      const instanceModule = await import('../src/internal/instance')
      const clearSpy = vi.spyOn(instanceModule, 'clearPageLifecycleCleanup')

      // Destroy the client
      destroyBKTClient()

      // Verify clearPageLifecycleCleanup was called
      expect(clearSpy).toHaveBeenCalledTimes(1)

      clearSpy.mockRestore()
    })
  })
})

function buildEvaluation(
  value: string,
  featureId: string = 'feature_id_value',
): Evaluation {
  return {
    id: 'evaluation_id_value',
    featureId: featureId,
    featureVersion: 1,
    userId: user1.id,
    variationId: 'variation_id_value',
    variationName: 'variation_name_value',
    variationValue: value,
    reason: {
      type: 'CLIENT',
    },
  }
}

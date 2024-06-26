import { rest } from 'msw'
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
} from 'vitest'
import {
  destroyBKTClient,
  getBKTClient,
  initializeBKTClientInternal,
} from '../src/BKTClient'
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
import fetch from 'cross-fetch'
import { user1 } from './mocks/users'
import { toBKTUser } from '../src/internal/UserHolder'
import {
  InternalServerErrorException,
  TimeoutException,
} from '../src/BKTExceptions'
import { Evaluation } from '../src/internal/model/Evaluation'
import { EventType } from '../src/internal/model/Event'
import { BKTEvaluation } from '../src/BKTEvaluation'
import { ErrorResponse } from '../src/internal/model/response/ErrorResponse'
import { RegisterEventsRequest } from '../src/internal/model/request/RegisterEventsRequest'
import { RegisterEventsResponse } from '../src/internal/model/response/RegisterEventsResponse'
import { DefaultComponent } from '../src/internal/di/Component'
import { DataModule } from '../src/internal/di/DataModule'
import { InteractorModule } from '../src/internal/di/InteractorModule'

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
      new DataModule(toBKTUser(user1), config),
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
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
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
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.delay(1000),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
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
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
        // second initializeBKTClient will fail if there's a API request
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, _ctx) => {
          return res.networkError('network error')
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
      rest.post<
        GetEvaluationsRequest,
        Record<string, never>,
        GetEvaluationsResponse
      >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
        return res.once(
          ctx.status(200),
          ctx.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          }),
        )
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
          rest.post<
            GetEvaluationsRequest,
            Record<string, never>,
            GetEvaluationsResponse
          >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
            return res.once(
              ctx.status(200),
              ctx.json({
                evaluations: {
                  ...user1Evaluations,
                  evaluations: [buildEvaluation(value)],
                },
                userEvaluationsId: 'user_evaluation_id_value',
              }),
            )
          }),
          rest.post<
            RegisterEventsRequest,
            Record<string, never>,
            RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
            return res(ctx.status(200), ctx.json({}))
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
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
          return res(ctx.status(200), ctx.json({}))
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
      // ['1', 0, 1],
      // ['-1', 0, -1],
      // ['1.0', 0, 1],
      ['1.0a', 0, 0],
      // ['no int', 0, 0],
    ])(
      'value=%s, default=%s, actual=%s',
      async (value: string, defaultValue: number, actual: number) => {
        server.use(
          rest.post<
            GetEvaluationsRequest,
            Record<string, never>,
            GetEvaluationsResponse
          >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
            return res.once(
              ctx.status(200),
              ctx.json({
                evaluations: {
                  ...user1Evaluations,
                  evaluations: [buildEvaluation(value)],
                },
                userEvaluationsId: 'user_evaluation_id_value',
              }),
            )
          }),
          rest.post<
            RegisterEventsRequest,
            Record<string, never>,
            RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
            return res(ctx.status(200), ctx.json({}))
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
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
          return res(ctx.status(200), ctx.json({}))
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      expect(client.numberVariation('feature_id_value', 99)).toBe(99)
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
          rest.post<
            GetEvaluationsRequest,
            Record<string, never>,
            GetEvaluationsResponse
          >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
            return res.once(
              ctx.status(200),
              ctx.json({
                evaluations: {
                  ...user1Evaluations,
                  evaluations: [buildEvaluation(value)],
                },
                userEvaluationsId: 'user_evaluation_id_value',
              }),
            )
          }),
          rest.post<
            RegisterEventsRequest,
            Record<string, never>,
            RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
            return res(ctx.status(200), ctx.json({}))
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
          rest.post<
            GetEvaluationsRequest,
            Record<string, never>,
            GetEvaluationsResponse
          >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
            return res.once(
              ctx.status(200),
              ctx.json({
                evaluations: {
                  ...user1Evaluations,
                  evaluations: [buildEvaluation(value)],
                },
                userEvaluationsId: 'user_evaluation_id_value',
              }),
            )
          }),
          rest.post<
            RegisterEventsRequest,
            Record<string, never>,
            RegisterEventsResponse
          >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
            return res(ctx.status(200), ctx.json({}))
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
      rest.post<
        GetEvaluationsRequest,
        Record<string, never>,
        GetEvaluationsResponse
      >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
        return res.once(
          ctx.status(200),
          ctx.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          }),
        )
      }),
      rest.post<
        RegisterEventsRequest,
        Record<string, never>,
        RegisterEventsResponse
      >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
        return res(ctx.status(200), ctx.json({}))
      }),
    )

    await initializeBKTClientInternal(component, 1000)

    const client = getBKTClient()

    assert(client !== null)

    client.track('goal_id_value', 0.4)

    const storage = getDefaultComponent(client).dataModule.eventStorage()

    const lastEvent = storage.getAll().at(-1)

    assert(lastEvent?.type === EventType.GOAL)

    expect(lastEvent.event.goalId).toBe('goal_id_value')
    expect(lastEvent.event.value).toBe(0.4)
  })

  test('currentUser', async () => {
    server.use(
      rest.post<
        GetEvaluationsRequest,
        Record<string, never>,
        GetEvaluationsResponse
      >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
        return res.once(
          ctx.status(200),
          ctx.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          }),
        )
      }),
    )

    await initializeBKTClientInternal(component, 1000)

    const client = getBKTClient()

    assert(client !== null)

    expect(client.currentUser()).toStrictEqual({
      id: 'user_id_1',
      attributes: {},
    })
  })

  test('updateUserAttributes', async () => {
    server.use(
      rest.post<
        GetEvaluationsRequest,
        Record<string, never>,
        GetEvaluationsResponse
      >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
        return res.once(
          ctx.status(200),
          ctx.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          }),
        )
      }),
      rest.post<
        RegisterEventsRequest,
        Record<string, never>,
        RegisterEventsResponse
      >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
        return res(ctx.status(200), ctx.json({}))
      }),
    )

    await initializeBKTClientInternal(component, 1000)

    const client = getBKTClient()

    assert(client !== null)

    const userHolder = getDefaultComponent(client).userHolder()
    const storage = getDefaultComponent(client).dataModule.evaluationStorage()

    expect(userHolder.get().data).toBeUndefined()
    expect(storage.getCurrentEvaluationsId()).toBe('user_evaluation_id_value')

    client.updateUserAttributes({ key: 'value' })

    expect(userHolder.get().data).toStrictEqual({ key: 'value' })
    expect(storage.getCurrentEvaluationsId()).toBe('user_evaluation_id_value')
    expect(storage.getUserAttributesUpdated()).toBeTruthy()
  })

  suite('fetchEvaluations', async () => {
    test('success', async () => {
      const updatedEvaluation1 = {
        ...evaluation1,
        variationValue: 'updated_evaluation_value',
      } satisfies Evaluation

      server.use(
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: {
                id: 'user_evaluation_id_value',
                evaluations: [evaluation1],
                createdAt: clock.currentTimeMillis().toString(),
                forceUpdate: false,
                archivedFeatureIds: [],
              },
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: {
                id: 'user_evaluation_id_value_updated',
                evaluations: [updatedEvaluation1],
                createdAt: clock.currentTimeMillis().toString(),
                forceUpdate: false,
                archivedFeatureIds: [],
              },
              userEvaluationsId: 'user_evaluation_id_value_updated',
            }),
          )
        }),
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
          return res(ctx.status(200), ctx.json({}))
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
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: {
                id: 'user_evaluation_id_value',
                evaluations: [evaluation1],
                createdAt: clock.currentTimeMillis().toString(),
                forceUpdate: false,
                archivedFeatureIds: [],
              },
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
        rest.post<GetEvaluationsRequest, Record<string, never>, ErrorResponse>(
          `${config.apiEndpoint}/get_evaluations`,
          (_req, res, ctx) => {
            return res.once(
              ctx.status(500),
              ctx.json({
                error: {
                  code: 500,
                  message: 'Internal Server Error',
                },
              }),
            )
          },
        ),
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, (_req, res, ctx) => {
          return res(ctx.status(200), ctx.json({}))
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
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${config.apiEndpoint}/register_events`, (req, res, ctx) => {
          return res.once(ctx.status(200), ctx.json({}))
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      const eventStorage = getDefaultComponent(client).dataModule.eventStorage()

      expect(eventStorage.getAll().length).toBe(2)

      await client.flush()

      expect(eventStorage.getAll().length).toBe(0)
    })

    test('failure', async () => {
      server.use(
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
        rest.post<RegisterEventsRequest, Record<string, never>, ErrorResponse>(
          `${config.apiEndpoint}/register_events`,
          (_req, res, ctx) => {
            return res.once(
              ctx.status(500),
              ctx.json({
                error: {
                  code: 500,
                  message: 'Internal Server Error',
                },
              }),
            )
          },
        ),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      const eventStorage = getDefaultComponent(client).dataModule.eventStorage()

      expect(eventStorage.getAll().length).toBe(2)

      await expect(() => client.flush()).rejects.toThrow(
        InternalServerErrorException,
      )

      expect(eventStorage.getAll().length).toBe(2)
    })
  })

  suite('evaluationDetails', () => {
    test('return BKTEvaluation if target evaluation exists', async () => {
      server.use(
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
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
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, (_req, res, ctx) => {
          return res.once(
            ctx.status(200),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id_value',
            }),
          )
        }),
      )

      await initializeBKTClientInternal(component, 1000)

      const client = getBKTClient()

      assert(client !== null)

      expect(client.evaluationDetails('non_existent_feature_id')).toBeNull()
    })
  })
})

function buildEvaluation(value: string): Evaluation {
  return {
    id: 'evaluation_id_value',
    featureId: 'feature_id_value',
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

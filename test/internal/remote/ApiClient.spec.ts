import {
  expect,
  suite,
  test,
  beforeEach,
  afterEach,
  afterAll,
  beforeAll,
  vi,
} from 'vitest'
import fetch from 'cross-fetch'
import { RestRequest, rest } from 'msw'
import assert from 'assert'
import { SetupServer } from 'msw/node'
import { GetEvaluationsRequest } from '../../../src/internal/model/request/GetEvaluationsRequest'
import { GetEvaluationsResponse } from '../../../src/internal/model/response/GetEvaluationsResponse'
import { user1Evaluations } from '../../mocks/evaluations'
import {
  ApiClient,
  ApiClientImpl,
} from '../../../src/internal/remote/ApiClient'
import { user1 } from '../../mocks/users'
import { SourceID } from '../../../src/internal/model/SourceID'
import { RegisterEventsRequest } from '../../../src/internal/model/request/RegisterEventsRequest'
import { evaluationEvent1, metricsEvent1 } from '../../mocks/events'
import { RegisterEventsResponse } from '../../../src/internal/model/response/RegisterEventsResponse'
import { setupServerAndListen } from '../../utils'
import { SDK_VERSION } from '../../../src/internal/version'
import { TimeoutException, UnknownException } from '../../../src/BKTExceptions'
import { MetricsEventType } from '../../../src/internal/model/MetricsEventData'

suite('internal/remote/ApiClient', () => {
  const endpoint = 'https://api.bucketeer.io'
  let server: SetupServer
  let apiClient: ApiClient

  beforeAll(() => {
    server = setupServerAndListen()
  })

  beforeEach(() => {
    apiClient = new ApiClientImpl(endpoint, 'api_key_value', fetch)
  })

  afterEach(() => {
    server.resetHandlers()
  })

  afterAll(() => {
    server.close()
  })

  suite('getEvaluations', () => {
    test('success', async () => {
      const requestInterceptor = vi.fn<
        [RestRequest<GetEvaluationsRequest>],
        void
      >()

      server.use(
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${endpoint}/get_evaluations`, async (req, res, ctx) => {
          requestInterceptor(req)

          return res(
            ctx.status(200),
            ctx.set('Content-Length', '10'),
            ctx.json({
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id',
            }),
          )
        }),
      )

      const response = await apiClient.getEvaluations({
        user: user1,
        userEvaluationsId: 'user_evaluation_id',
        tag: 'feature_tag_value',
        userEvaluationCondition: {
          evaluatedAt: '0',
          userAttributesUpdated: false,
        },
      })

      assert(response.type === 'success')

      expect(response.type).toBe('success')
      expect(response.sizeByte).toBe(10)
      expect(response.seconds).toBeGreaterThan(0)
      expect(response.featureTag).toBe('feature_tag_value')
      expect(response.value).toStrictEqual({
        evaluations: user1Evaluations,
        userEvaluationsId: 'user_evaluation_id',
      })

      expect(requestInterceptor).toHaveBeenCalledTimes(1)

      const request = requestInterceptor.mock.calls[0][0]

      expect(request.headers.get('Authorization')).toBe('api_key_value')

      const requestBody = await request.json()
      expect(requestBody).toStrictEqual<GetEvaluationsRequest>({
        tag: 'feature_tag_value',
        user: user1,
        userEvaluationsId: 'user_evaluation_id',
        sourceId: SourceID.JAVASCRIPT,
        sdkVersion: SDK_VERSION,
        userEvaluationCondition: {
          evaluatedAt: '0',
          userAttributesUpdated: false,
        },
      })
    })

    test('network error', async () => {
      server.use(
        rest.post(`${endpoint}/get_evaluations`, (_req, res, _ctx) => {
          return res.networkError('network error')
        }),
      )

      const response = await apiClient.getEvaluations({
        user: user1,
        userEvaluationsId: 'user_evaluation_id',
        tag: 'feature_tag_value',
        userEvaluationCondition: {
          evaluatedAt: '0',
          userAttributesUpdated: false,
        },
      })

      assert(response.type === 'failure')

      expect(response.type).toBe('failure')
      expect(response.featureTag).toBe('feature_tag_value')
      expect(response.error.name).toBe('NetworkException')
    })

    suite('timeout error', async () => {
      test('initial timeout', async () => {
        apiClient = new ApiClientImpl(endpoint, 'api_key_value', fetch, 200)
        server.use(
          rest.post(`${endpoint}/get_evaluations`, async (_req, res, ctx) => {
            return res(
              ctx.delay(1000),
              ctx.status(500),
              ctx.body('{ "error": "super slow response"}'),
            )
          }),
        )

        const response = await apiClient.getEvaluations({
          user: user1,
          userEvaluationsId: 'user_evaluation_id',
          tag: 'feature_tag_value',
          userEvaluationCondition: {
            evaluatedAt: '0',
            userAttributesUpdated: false,
          },
        })

        assert(response.type === 'failure')

        expect(response.type).toBe('failure')
        expect(response.featureTag).toBe('feature_tag_value')

        const error = response.error

        assert(error instanceof TimeoutException)

        expect(error.name).toBe('TimeoutException')
        expect(error.type).toBe(MetricsEventType.TimeoutError)
        expect(error.timeoutMillis).toBe(200)
      })

      test('passig timeout value from getEvaluations', async () => {
        apiClient = new ApiClientImpl(endpoint, 'api_key_value', fetch, 200)
        server.use(
          rest.post(`${endpoint}/get_evaluations`, async (_req, res, ctx) => {
            return res(
              ctx.delay(1000),
              ctx.status(500),
              ctx.body('{ "error": "super slow response"}'),
            )
          }),
        )

        const response = await apiClient.getEvaluations(
          {
            user: user1,
            userEvaluationsId: 'user_evaluation_id',
            tag: 'feature_tag_value',
            userEvaluationCondition: {
              evaluatedAt: '0',
              userAttributesUpdated: false,
            },
          },
          500,
        )

        assert(response.type === 'failure')

        expect(response.type).toBe('failure')
        expect(response.featureTag).toBe('feature_tag_value')

        const error = response.error

        assert(error instanceof TimeoutException)

        expect(error.name).toBe('TimeoutException')
        expect(error.type).toBe(MetricsEventType.TimeoutError)
        expect(error.timeoutMillis).toBe(500)
      })
    })
  })

  suite('registerEvents', () => {
    test('success', async () => {
      const requestInterceptor = vi.fn<
        [RestRequest<RegisterEventsRequest>],
        void
      >()

      server.use(
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${endpoint}/register_events`, async (req, res, ctx) => {
          requestInterceptor(req)

          return res(
            ctx.status(200),
            ctx.set('Content-Length', '10'),
            ctx.json<RegisterEventsResponse>({
              errors: {
                [evaluationEvent1.id]: {
                  retriable: true,
                  message: 'error',
                },
              },
            }),
          )
        }),
      )

      const response = await apiClient.registerEvents([
        evaluationEvent1,
        metricsEvent1,
      ])

      assert(response.type === 'success')

      expect(response.value).toStrictEqual({
        errors: {
          [evaluationEvent1.id]: {
            retriable: true,
            message: 'error',
          },
        },
      })

      const request = requestInterceptor.mock.calls[0][0]
      expect(request.headers.get('Authorization')).toBe('api_key_value')

      const requestBody = await request.json()
      expect(requestBody).toStrictEqual<RegisterEventsRequest>({
        events: [evaluationEvent1, metricsEvent1],
        sdkVersion: SDK_VERSION,
        sourceId: SourceID.JAVASCRIPT,
      })
    })

    test('network error', async () => {
      server.use(
        rest.post(`${endpoint}/register_events`, (_req, res, _ctx) => {
          return res.networkError('network error')
        }),
      )

      const response = await apiClient.registerEvents([
        evaluationEvent1,
        metricsEvent1,
      ])

      assert(response.type === 'failure')

      expect(response.type).toBe('failure')
      expect(response.error.name).toBe('NetworkException')
    })

    test('timeout error', async () => {
      apiClient = new ApiClientImpl(endpoint, 'api_key_value', fetch, 200)
      server.use(
        rest.post(`${endpoint}/register_events`, async (_req, res, ctx) => {
          return res(
            ctx.delay(1000),
            ctx.status(500),
            ctx.body('{ "error": "super slow response"}'),
          )
        }),
      )

      const response = await apiClient.registerEvents([
        evaluationEvent1,
        metricsEvent1,
      ])

      assert(response.type === 'failure')

      expect(response.type).toBe('failure')

      const error = response.error

      assert(error instanceof TimeoutException)

      expect(error.name).toBe('TimeoutException')
      expect(error.type).toBe(MetricsEventType.TimeoutError)
      expect(error.timeoutMillis).toBe(200)
    })

    test('response status okay with invaild JSON response', async () => {
      apiClient = new ApiClientImpl(endpoint, 'api_key_value', fetch, 200)
      server.use(
        rest.post(`${endpoint}/register_events`, async (_req, res, ctx) => {
          return res(ctx.status(200), ctx.body('Text'))
        }),
      )

      const response = await apiClient.registerEvents([
        evaluationEvent1,
        metricsEvent1,
      ])

      expect(response.type).toBe('failure')

      const error = response.error

      expect(error.name).toBe('UnknownException')
      expect(error.type).toBe(MetricsEventType.UnknownError)

      const unknownException = error as UnknownException
      expect(unknownException.type).toBe(MetricsEventType.UnknownError)
    })
  })
})

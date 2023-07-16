import {
  expect,
  suite,
  test,
  beforeEach,
  afterEach,
  afterAll,
  beforeAll,
} from 'vitest'
import fetch from 'cross-fetch'
import { rest } from 'msw'
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
      server.use(
        rest.post<
          GetEvaluationsRequest,
          Record<string, never>,
          GetEvaluationsResponse
        >(`${endpoint}/get_evaluations`, async (req, res, ctx) => {
          expect(req.headers.get('Authorization')).toBe('api_key_value')

          const request = await req.json()
          expect(request).toStrictEqual<GetEvaluationsRequest>({
            tag: 'feature_tag_value',
            user: user1,
            userEvaluationsId: 'user_evaluation_id',
            sourceId: SourceID.JAVASCRIPT,
          })

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
      })

      assert(response.type === 'failure')

      expect(response.type).toBe('failure')
      expect(response.featureTag).toBe('feature_tag_value')
      expect(response.error.name).toBe('NetworkException')
    })

    test('timeout error', async () => {
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
      })

      assert(response.type === 'failure')

      expect(response.type).toBe('failure')
      expect(response.featureTag).toBe('feature_tag_value')
      expect(response.error.name).toBe('TimeoutException')
    })
  })

  suite('registerEvents', () => {
    test('success', async () => {
      server.use(
        rest.post<
          RegisterEventsRequest,
          Record<string, never>,
          RegisterEventsResponse
        >(`${endpoint}/register_events`, async (req, res, ctx) => {
          expect(req.headers.get('Authorization')).toBe('api_key_value')

          const request = await req.json()
          expect(request).toStrictEqual<RegisterEventsRequest>({
            events: [evaluationEvent1, metricsEvent1],
          })

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
      expect(response.error.name).toBe('TimeoutException')
    })
  })
})

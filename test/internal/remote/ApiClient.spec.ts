import { expect, suite, test, beforeEach, afterEach } from 'vitest'
import fetch from 'cross-fetch'
import { rest } from 'msw'
import assert from 'assert'
import { setupServer, SetupServer } from 'msw/node'
import { GetEvaluationsRequest } from '../../../src/internal/model/request/GetEvaluationsRequest'
import { GetEvaluationsResponse } from '../../../src/internal/model/response/GetEvaluationsResponse'
import { user1Evaluations } from '../../mocks/evaluations'
import { ApiClient, ApiClientImpl } from '../../../src/internal/remote/ApiClient'
import { user1 } from '../../mocks/users'
import { SourceID } from '../../../src/internal/model/SourceID'
import { RegisterEventsRequest } from '../../../src/internal/model/request/RegisterEventsRequest'
import { evaluationEvent1, metricsEvent1 } from '../../mocks/events'
import { RegisterEventsResponse } from '../../../src/internal/model/response/RegisterEventsResponse'

suite('internal/remote/ApiClient', () => {
  let server: SetupServer
  let apiClient: ApiClient

  beforeEach(() => {
    apiClient = new ApiClientImpl(
      'https://api.bucketeer.io',
      'api_key_value',
      'feature_tag_value',
      fetch
    )
  })

  afterEach(() => {
    server.close()
  })

  suite('getEvaluations', () => {
    test('success', async () => {
      server = setupServer(
        rest.post<GetEvaluationsRequest, Record<string, never>, GetEvaluationsResponse>(
          'https://api.bucketeer.io/get_evaluations',
          async (req, res, ctx) => {
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
          })
      )
      server.listen({ onUnhandledRequest: 'error' })

      const response = await apiClient.getEvaluations(user1, 'user_evaluation_id')

      assert(response.type === 'success')

      expect(response.type).toBe('success')
      expect(response.sizeByte).toBe(10)
      expect(response.seconds).toBeGreaterThan(0)
      expect(response.featureTag).toBe('feature_tag_value')
      expect(response.value).toStrictEqual({
        evaluations: user1Evaluations,
        userEvaluationsId: 'user_evaluation_id'
      })
    })

    test('network error', async () => {
      server = setupServer(
        rest.post(
          'https://api.bucketeer.io/get_evaluations',
          (_req, res, _ctx) => {
            return res.networkError('network error')
          }
        )
      )
      server.listen({ onUnhandledRequest: 'error' })

      const response = await apiClient.getEvaluations(user1, 'user_evaluation_id')

      assert(response.type === 'failure')

      expect(response.type).toBe('failure')
      expect(response.featureTag).toBe('feature_tag_value')
      expect(response.error.name).toBe('NetworkException')
    })

    test('timeout error', async () => {
      apiClient = new ApiClientImpl(
        'https://api.bucketeer.io',
        'api_key_value',
        'feature_tag_value',
        fetch,
        200
      )
      server = setupServer(
        rest.post(
          'https://api.bucketeer.io/get_evaluations',
          async (_req, res, ctx) => {
            return res(
              ctx.delay(1000),
              ctx.status(500),
              ctx.body('{ "error": "super slow response"}')
            )
          }
        )
      )
      server.listen({ onUnhandledRequest: 'error' })

      const response = await apiClient.getEvaluations(user1, 'user_evaluation_id')

      assert(response.type === 'failure')

      expect(response.type).toBe('failure')
      expect(response.featureTag).toBe('feature_tag_value')
      expect(response.error.name).toBe('TimeoutException')
    })
  })

  suite('registerEvents', () => {
    test('success', async () => {
      server = setupServer(
        rest.post<RegisterEventsRequest, Record<string, never>, RegisterEventsResponse>(
          'https://api.bucketeer.io/register_events',
          async (req, res, ctx) => {
            expect(req.headers.get('Authorization')).toBe('api_key_value')

            const request = await req.json()
            expect(request).toStrictEqual<RegisterEventsRequest>({
              events: [evaluationEvent1, metricsEvent1]
            })

            return res(
              ctx.status(200),
              ctx.set('Content-Length', '10'),
              ctx.json<RegisterEventsResponse>({
                errors: {
                  [evaluationEvent1.id]: {
                    retriable: true,
                    message: 'error'
                  }
                }
              }),
            )
          })
      )
      server.listen({ onUnhandledRequest: 'error' })

      const response = await apiClient.registerEvents([evaluationEvent1, metricsEvent1])

      assert(response.type === 'success')

      expect(response.value).toStrictEqual({
        errors: {
          [evaluationEvent1.id]: {
            retriable: true,
            message: 'error'
          }
        }
      })
    })

    test('network error', async () => {
      server = setupServer(
        rest.post(
          'https://api.bucketeer.io/register_events',
          (_req, res, _ctx) => {
            return res.networkError('network error')
          }
        )
      )
      server.listen({ onUnhandledRequest: 'error' })

      const response = await apiClient.registerEvents([evaluationEvent1, metricsEvent1])

      assert(response.type === 'failure')

      expect(response.type).toBe('failure')
      expect(response.error.name).toBe('NetworkException')
    })

    test('timeout error', async () => {
      apiClient = new ApiClientImpl(
        'https://api.bucketeer.io',
        'api_key_value',
        'feature_tag_value',
        fetch,
        200
      )
      server = setupServer(
        rest.post(
          'https://api.bucketeer.io/register_events',
          async (_req, res, ctx) => {
            return res(
              ctx.delay(1000),
              ctx.status(500),
              ctx.body('{ "error": "super slow response"}')
            )
          }
        )
      )
      server.listen({ onUnhandledRequest: 'error' })

      const response = await apiClient.registerEvents([evaluationEvent1, metricsEvent1])

      assert(response.type === 'failure')

      expect(response.type).toBe('failure')
      expect(response.error.name).toBe('TimeoutException')
    })
  })
})

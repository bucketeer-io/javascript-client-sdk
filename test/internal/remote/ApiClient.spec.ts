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

import { HttpResponse, http, delay, StrictRequest } from 'msw'
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
    apiClient = new ApiClientImpl(
      endpoint,
      'api_key_value',
      fetch,
      SourceID.JAVASCRIPT,
      SDK_VERSION,
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  afterAll(() => {
    server.close()
  })

  suite('getEvaluations', () => {
    test('success', async () => {
      const requestInterceptor = vi.fn(
        (_request: StrictRequest<GetEvaluationsRequest>) => { },
      )

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${endpoint}/get_evaluations`, async ({ request }) => {
          requestInterceptor(request)
          return HttpResponse.json(
            {
              evaluations: user1Evaluations,
              userEvaluationsId: 'user_evaluation_id',
            },
            { headers: { 'Content-Length': '10' } },
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
        http.post(`${endpoint}/get_evaluations`, () => {
          return HttpResponse.error()
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
        apiClient = new ApiClientImpl(
          endpoint,
          'api_key_value',
          fetch,
          SourceID.JAVASCRIPT,
          SDK_VERSION,
          200,
        )
        server.use(
          http.post(`${endpoint}/get_evaluations`, async () => {
            await delay(1000)
            return HttpResponse.json(
              { error: 'super slow response' },
              { status: 500 },
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

        const error = response.error || null

        assert(error instanceof TimeoutException)

        expect(error.name).toBe('TimeoutException')
        expect(error.type).toBe(MetricsEventType.TimeoutError)
        expect(error.timeoutMillis).toBe(200)
      })

      test('passig timeout value from getEvaluations', async () => {
        apiClient = new ApiClientImpl(
          endpoint,
          'api_key_value',
          fetch,
          SourceID.JAVASCRIPT,
          SDK_VERSION,
          200,
        )
        server.use(
          http.post(`${endpoint}/get_evaluations`, async () => {
            await delay(1000)
            return HttpResponse.json(
              { error: 'super slow response' },
              { status: 500 },
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
      const requestInterceptor = vi.fn()

      server.use(
        http.post<
          Record<string, never>,
          RegisterEventsRequest,
          RegisterEventsResponse
        >(`${endpoint}/register_events`, async ({ request }) => {
          requestInterceptor(request)
          return HttpResponse.json({
            errors: {
              [evaluationEvent1.id]: {
                retriable: true,
                message: 'error',
              },
            },
          })
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
        http.post(`${endpoint}/register_events`, () => {
          return HttpResponse.error()
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
      apiClient = new ApiClientImpl(
        endpoint,
        'api_key_value',
        fetch,
        SourceID.JAVASCRIPT,
        SDK_VERSION,
        200,
      )
      server.use(
        http.post(`${endpoint}/register_events`, async () => {
          await delay(1000)
          return HttpResponse.json(
            { error: 'super slow response' },
            { status: 500 },
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

    test('got a response with status 200 and invalid JSON', async () => {
      apiClient = new ApiClientImpl(
        endpoint,
        'api_key_value',
        fetch,
        SourceID.JAVASCRIPT,
        SDK_VERSION,
        200,
      )
      server.use(
        http.post(`${endpoint}/register_events`, async () => {
          return HttpResponse.text('Text')
        }),
      )

      const response = await apiClient.registerEvents([
        evaluationEvent1,
        metricsEvent1,
      ])

      assert(response.type === 'failure')
      expect(response.type).toBe('failure')

      const error = response.error
      expect(error.name).toBe('UnknownException')

      const unknownException = error as UnknownException
      expect(unknownException.type).toBe(MetricsEventType.UnknownError)
      expect(unknownException.statusCode).toBe(200)
      expect(unknownException.message).contain('invaild JSON response')
    })
  })
})

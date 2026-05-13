import { describe, it, expect, vi, afterEach } from 'vitest'

import { ApiClientImpl } from '../../../src/internal/remote/ApiClient'
import { FetchLike } from '../../../src/internal/remote/fetch'
import { SourceId } from '../../../src/internal/model/SourceId'
import { SDK_VERSION } from '../../../src/internal/version'
import { user1 } from '../../mocks/users'

describe('ApiClientImpl - Evaluation Latency', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })


  it('should measure getEvaluations seconds from the last attempt only', async () => {
    vi.useFakeTimers()

    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const mockFetch = vi.fn<FetchLike>()

    // Keep postInternal real and mock only fetch, so retries still trigger
    // onAttemptStart and the test measures final-attempt latency correctly.
    mockFetch
      .mockImplementationOnce(async () => {
        now += 25
        return {
          ok: false,
          status: 499,
          statusText: 'Client Closed Request',
          headers: {
            get: () => null,
          },
          text: () => Promise.resolve('{"error": {"message": "Client Closed Request"}}'),
          json: () => Promise.resolve({ error: { message: 'Client Closed Request' } }),
        }
      })
      .mockImplementationOnce(async () => {
        now += 12
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {
            get: (name: string) => name === 'Content-Length' ? '10' : null,
          },
          json: () => Promise.resolve({
            evaluations: [],
            userEvaluationsId: 'test_id',
          }),
          text: () => Promise.resolve(''),
        }
      })

    const apiClient = new ApiClientImpl(
      'https://api.example.com',
      'test_api_key',
      mockFetch,
      SourceId.JAVASCRIPT,
      SDK_VERSION,
    )

    const responsePromise = apiClient.getEvaluations({
      user: user1,
      userEvaluationsId: 'test_id',
      tag: 'test_tag',
      userEvaluationCondition: {
        evaluatedAt: '0',
        userAttributesUpdated: false,
      },
    })

    await Promise.resolve()
    now += 1000
    await vi.advanceTimersByTimeAsync(1000)

    const response = await responsePromise

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(response.type).toBe('success')
    if (response.type !== 'success') {
      throw new Error(`expected success, got ${response.type}`)
    }
    expect(response.seconds).toBeCloseTo(0.012, 6)
  })
})

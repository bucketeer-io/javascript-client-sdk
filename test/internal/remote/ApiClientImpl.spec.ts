import { describe, it, expect, vi } from 'vitest'

import { ApiClientImpl } from '../../../src/internal/remote/ApiClient'
import { FetchResponseLike } from '../../../src/internal/remote/fetch'
import { SourceId } from '../../../src/internal/model/SourceId'
import { SDK_VERSION } from '../../../src/internal/version'
import { user1 } from '../../mocks/users'
import * as postModule from '../../../src/internal/remote/post'

describe('ApiClientImpl', () => {
  it('should call postInternal', async () => {
    vi.restoreAllMocks()

    const mockResponse: FetchResponseLike = {
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

    const spy = vi.spyOn(postModule, 'postInternal').mockResolvedValue(mockResponse)

    const apiClient = new ApiClientImpl(
      'https://api.example.com',
      'test_api_key',
      fetch,
      SourceId.JAVASCRIPT,
      SDK_VERSION,
    )

    await apiClient.getEvaluations({
      user: user1,
      userEvaluationsId: 'test_id',
      tag: 'test_tag',
      userEvaluationCondition: {
        evaluatedAt: '0',
        userAttributesUpdated: false,
      },
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(
      'https://api.example.com/get_evaluations',
      {
        'Content-Type': 'application/json',
        Authorization: 'test_api_key',
      },
      {
        user: user1,
        userEvaluationsId: 'test_id',
        tag: 'test_tag',
        sourceId: SourceId.JAVASCRIPT,
        sdkVersion: SDK_VERSION,
        userEvaluationCondition: {
          evaluatedAt: '0',
          userAttributesUpdated: false,
        },
      },
      fetch,
      30000, // default timeout
    )
  })
})

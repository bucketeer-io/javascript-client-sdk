import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { postInternal } from '../../../src/internal/remote/post'
import { FetchLike } from '../../../src/internal/remote/fetch'

describe('postInternal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should retry on 499 Client Closed Request error', async () => {
    const mockFetch = vi.fn<FetchLike>()

    // Mock fetch to return 499 on first call, then 200 on second
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 499, // Should map into ClientClosedRequestException
        statusText: 'Client Closed Request',
        text: () => Promise.resolve('{"error": {"message": "Client Closed Request"}}'),
        json: () => Promise.resolve({ error: { message: 'Client Closed Request' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({}),
      } as Response)

    const endpoint = 'https://api.example.com/test'
    const headers = { 'Content-Type': 'application/json' }
    const body = { key: 'value' }
    const timeoutMillis = 5000

    const resultPromise = postInternal(endpoint, headers, body, mockFetch, timeoutMillis)

    // Advance only the retry delay (1s) after flushing microtasks
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)

    const result = await resultPromise

    // Should have retried once (called twice total)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // First call should be with the correct parameters
    expect(mockFetch).toHaveBeenNthCalledWith(1, endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: expect.any(AbortSignal),
    })

    // Second call should be the same
    expect(mockFetch).toHaveBeenNthCalledWith(2, endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: expect.any(AbortSignal),
    })

    // Result should be the successful response
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
  })

  it('should call onAttemptStart once when request succeeds without retry', async () => {
    const mockFetch = vi.fn<FetchLike>()
    const onAttemptStart = vi.fn()
    const endpoint = 'https://api.example.com/test'
    const headers = { 'Content-Type': 'application/json' }
    const body = { key: 'value' }
    const timeoutMillis = 5000

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    } as Response)

    const result = await postInternal(
      endpoint,
      headers,
      body,
      mockFetch,
      timeoutMillis,
      onAttemptStart,
    )

    expect(onAttemptStart).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
  })

  it('should call onAttemptStart on each attempt including retries', async () => {
    const mockFetch = vi.fn<FetchLike>()
    const onAttemptStart = vi.fn()
    const endpoint = 'https://api.example.com/test'
    const headers = { 'Content-Type': 'application/json' }
    const body = { key: 'value' }
    const timeoutMillis = 5000

    const response499 = {
      ok: false,
      status: 499,
      statusText: 'Client Closed Request',
      text: () => Promise.resolve('{"error": {"message": "Client Closed Request"}}'),
      json: () => Promise.resolve({ error: { message: 'Client Closed Request' } }),
    } as Response

    mockFetch
      .mockResolvedValueOnce(response499)
      .mockResolvedValueOnce(response499)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({}),
      } as Response)

    const resultPromise = postInternal(
      endpoint,
      headers,
      body,
      mockFetch,
      timeoutMillis,
      onAttemptStart,
    )

    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2000)

    const result = await resultPromise

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(onAttemptStart).toHaveBeenCalledTimes(3)
    expect(result.ok).toBe(true)
  })

  it('should work normally when onAttemptStart is not provided', async () => {
    const mockFetch = vi.fn<FetchLike>()
    const endpoint = 'https://api.example.com/test'
    const headers = { 'Content-Type': 'application/json' }
    const body = { key: 'value' }
    const timeoutMillis = 5000

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    } as Response)

    const result = await postInternal(endpoint, headers, body, mockFetch, timeoutMillis)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
  })
})

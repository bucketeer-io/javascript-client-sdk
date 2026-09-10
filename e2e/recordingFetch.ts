import { expect, vi } from 'vitest'
import { FetchLike, FetchResponseLike } from '../src/internal/remote/fetch'

export const recordingFetch = (base: FetchLike) => {
  const urls: string[] = []
  const responses: { url: string; response: FetchResponseLike }[] = []
  // Plain call, never `base.call(this, ...)`: the SDK calls fetch receiver-free
  // on purpose (see FetchEventSource.connect), and window.fetch must stay unbound.
  const fetch: FetchLike = (url, request) => {
    urls.push(url)
    return base(url, request).then((response) => {
      responses.push({ url, response })
      return response
    })
  }
  const countOf = (path: string) => urls.filter((u) => u.endsWith(path)).length
  // Resolved response for the most recent recorded call whose URL ends with
  // `path`, so callers can check ok/status - not just that a request was
  // sent. Uses the most recent one (not the first) so a retry after a
  // recoverable failure is reflected here instead of being hidden behind the
  // earlier failed attempt.
  const responseFor = (path: string) =>
    responses.findLast((r) => r.url.endsWith(path))?.response
  return { fetch, urls, countOf, responseFor }
}

// FetchEventSource only opens the connection once the stream request's
// response resolves with ok: true AND a usable readable body - a response
// with no body (or one whose body has no getReader(), e.g. a runtime/fetch
// that can't stream) is treated as terminal instead of open
// (src/internal/streaming/FetchEventSource.ts). `recordingFetch` records the
// response at the same point, not when the request is merely sent.
// initializeBKTClient() resolves once the REST get_evaluations call
// finishes, and the stream request can still be connecting at that point, so
// tests that need the stream open (not just requested) before doing
// something else should wait on this first.
export const waitForStreamOpen = (
  recorder: Pick<ReturnType<typeof recordingFetch>, 'responseFor'>,
  timeout = 20_000,
) =>
  vi.waitFor(
    () => {
      const streamResponse = recorder.responseFor(
        '/v1/gateway/stream_evaluations',
      )
      expect(streamResponse?.ok).toBe(true)
      expect(typeof streamResponse?.body?.getReader).toBe('function')
    },
    { timeout, interval: 500 },
  )

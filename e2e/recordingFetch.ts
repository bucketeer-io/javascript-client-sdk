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
  // Resolved response for the first recorded call whose URL ends with `path`,
  // so callers can check ok/status - not just that a request was sent.
  const responseFor = (path: string) =>
    responses.find((r) => r.url.endsWith(path))?.response
  return { fetch, urls, countOf, responseFor }
}

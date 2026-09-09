import { FetchLike } from '../src/internal/remote/fetch'

export const recordingFetch = (base: FetchLike) => {
  const urls: string[] = []
  // Plain call, never `base.call(this, ...)`: the SDK calls fetch receiver-free
  // on purpose (see FetchEventSource.connect), and window.fetch must stay unbound.
  const fetch: FetchLike = (url, request) => {
    urls.push(url)
    return base(url, request)
  }
  const countOf = (path: string) => urls.filter((u) => u.endsWith(path)).length
  return { fetch, urls, countOf }
}

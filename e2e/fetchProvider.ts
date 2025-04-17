import { FetchLike } from '../src/internal/remote/fetch'

let fetchLike: FetchLike

function setFetchProvider(fetch: FetchLike) {
  fetchLike = fetch
}

export { setFetchProvider, fetchLike }

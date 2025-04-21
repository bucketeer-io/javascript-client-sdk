import { FetchLike } from '../src/internal/remote/fetch'

let fetchLike: FetchLike
let isNodeEnvironment = false

function setFetchProvider(fetch: FetchLike) {
  fetchLike = fetch
}

function setIsNodeEnvironment(isNode: boolean) {
  isNodeEnvironment = isNode
}

export {
  setFetchProvider,
  setIsNodeEnvironment,
  fetchLike,
  isNodeEnvironment,
}

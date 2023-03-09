import { NetworkException, TimeoutException } from '../../BKTExceptions'
import { FetchLike, FetchRequestLike, FetchResponseLike } from './fetch'
import { toBKTException } from './toBKTException'

export const postInternal = async (
  endpoint: string,
  headers: FetchRequestLike['headers'],
  body: object,
  fetch: FetchLike,
  timeoutMillis: number,
): Promise<FetchResponseLike> => {
  const controller = new AbortController()

  // timeout
  const id = setTimeout(() => controller.abort(), timeoutMillis)

  const result = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    // clear timeout
    .finally(() => clearTimeout(id))
    .catch((e) => {
      if (e.name === 'AbortError') {
        throw new TimeoutException('Timeout Error')
      } else {
        // convert network error to NetworkException
        throw new NetworkException(`Network Error: ${e.message}`)
      }
    })
    .then(async (res) => {
      // convert non-200 status to BKTException
      if (!res.ok) {
        const error = await toBKTException(res)
        throw error
      }
      return res
    })

  return result
}

import { ClientClosedRequestException, NetworkException, TimeoutException } from '../../BKTExceptions'
import { FetchLike, FetchRequestLike, FetchResponseLike } from './fetch'
import { promiseRetriable, RetryPolicy } from './PromiseRetriable'
import { addTimeoutValueIfNeeded, toBKTException } from './toBKTException'

/**
 * Sends a POST request with automatic retry on deployment-related 499 errors.
 *
 * @param onAttemptStart - Optional callback invoked at the start of **each** attempt
 *   (including the first and every retry). Use this hook when you need a measurement
 *   that reflects only the most-recent attempt — for example, resetting a latency timer
 *   so that backoff delays and prior failed attempts are excluded from the final value.
 *
 *   Example — accurate per-attempt latency:
 *   ```ts
 *   let startMillis = latencyStartMillis()
 *   await postInternal(endpoint, headers, body, fetch, timeoutMillis,
 *     () => { startMillis = latencyStartMillis() }
 *   )
 *   const seconds = latencySecondsSince(startMillis) // reflects the last attempt only
 *   ```
 */
export const postInternal = async (
  endpoint: string,
  headers: FetchRequestLike['headers'],
  body: object,
  fetch: FetchLike,
  timeoutMillis: number,
  onAttemptStart?: () => void,
): Promise<FetchResponseLike> => {
  const retryPolicy: RetryPolicy = {
    maxRetries: 3,
    delay: 1000,
    backoffStrategy: 'linear',
  }
  // Retry only on a deployment-related 499
  const shouldRetry = (error: Error): boolean => {
    return error instanceof ClientClosedRequestException
  }
  // Default retry logic when we got a deployment-related 499 error
  return promiseRetriable(
    () => {
      // Notify the caller that a new attempt is starting before issuing the request.
      // This allows the caller to reset any per-attempt state (e.g. a latency timer).
      onAttemptStart?.()
      return _postInternal(
        endpoint,
        headers,
        body,
        fetch,
        timeoutMillis,
      )
    },
    retryPolicy,
    shouldRetry,
  )
}

const _postInternal = async (
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
        throw new TimeoutException(timeoutMillis, 'Timeout Error')
      } else {
        // convert network error to NetworkException
        throw new NetworkException(`Network Error: ${e.message}`)
      }
    })
    .then(async (res) => {
      // convert non-200 status to BKTException
      if (!res.ok) {
        const error = addTimeoutValueIfNeeded(
          await toBKTException(res),
          timeoutMillis,
        )
        throw error
      }
      return res
    })

  return result
}

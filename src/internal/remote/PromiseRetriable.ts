export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Base delay before the first retry attempt in milliseconds */
  delay: number
  /** Strategy for calculating retry delays. Defaults to linear. */
  backoffStrategy?: BackoffStrategy
}

export type BackoffStrategy = 'constant' | 'linear'

/**
 * Function to determine if an error should trigger a retry
 */
export type ShouldRetryFn = (error: Error) => boolean

/**
 * A generic retry utility that executes a function with configurable retry logic
 * @param fn The function to execute
 * @param retryPolicy The retry configuration
 * @param shouldRetry Function to determine if error should trigger retry
 * @returns Promise resolving to the result or throwing the last error
 */
export async function promiseRetriable<T>(
  fn: () => Promise<T>,
  retryPolicy: RetryPolicy,
  shouldRetry: ShouldRetryFn
): Promise<T> {
  const { maxRetries } = retryPolicy
  let attempts = 0

  while (attempts <= maxRetries) {
    attempts++

    try {
      return await fn()
    } catch (error) {
      const lastError = error instanceof Error ? error : new Error(String(error))

      // If this was the last attempt or we shouldn't retry this error, throw
      if (attempts > maxRetries || !shouldRetry(lastError)) {
        throw lastError
      }

      // Wait before next attempt
      const waitTime = getBackoffDelay(attempts, retryPolicy)
      if (waitTime > 0) {
        await sleep(waitTime)
      }
    }
  }

  // This should never be reached due to the logic above
  throw new Error('Unexpected end of retry loop')
}

/**
 * Sleep utility function
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getBackoffDelay(attempt: number, retryPolicy: RetryPolicy): number {
  const baseDelay = Math.max(0, retryPolicy.delay)
  if (baseDelay === 0) {
    return 0
  }

  const strategy = retryPolicy.backoffStrategy ?? 'linear'

  switch (strategy) {
    case 'constant':
      return baseDelay
    case 'linear':
    default:
      return baseDelay * Math.max(1, attempt)
  }
}

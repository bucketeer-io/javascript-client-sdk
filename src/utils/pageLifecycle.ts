/**
 * Utility to handle page lifecycle events for flushing events before the page is unloaded.
 *
 * This handles:
 * - pagehide: Fired when the user navigates away
 * - visibilitychange: Fired when the page becomes hidden (switching tabs, minimizing)
 * - beforeunload: Fallback for older browsers
 */

export type FlushCallback = () => Promise<void> | void

interface PageLifecycleOptions {
  /**
   * Callback to flush events. Should send events using navigator.sendBeacon or similar
   */
  onFlush: FlushCallback
}

/**
 * Sets up page lifecycle listeners to automatically flush events before page unload.
 * Returns a cleanup function to remove the listeners.
 *
 * @example
 * ```typescript
 * const cleanup = setupPageLifecycleListeners({
 *   onFlush: async () => {
 *     await client.flush()
 *   }
 * })
 *
 * // Later, when destroying the client:
 * cleanup()
 * ```
 */
export function setupPageLifecycleListeners(
  options: PageLifecycleOptions,
): () => void {
  const { onFlush } = options

  // Track if we've already flushed to avoid duplicate flushes
  let hasFlushed = false

  const flush = () => {
    if (hasFlushed) {
      return
    }
    hasFlushed = true

    try {
      onFlush()
    } catch (error) {
      console.error(
        '[Bucketeer] Failed to flush events on page lifecycle:',
        error,
      )
    }
  }

  // Handler for pagehide event (most reliable for modern browsers)
  const pagehideHandler = () => {
    flush()
  }

  // Handler for visibilitychange event (when tab is hidden/backgrounded)
  const visibilityChangeHandler = () => {
    if (document.visibilityState === 'hidden') {
      flush()
    }
  }

  // Handler for beforeunload (fallback for older browsers)
  const beforeunloadHandler = () => {
    flush()
  }

  // Add event listeners
  // Priority order: pagehide > visibilitychange > beforeunload

  if (typeof window !== 'undefined') {
    // pagehide is the most reliable event for detecting page unload
    window.addEventListener('pagehide', pagehideHandler)

    // visibilitychange helps catch cases where the page is hidden but not unloaded
    // (e.g., user switches tabs, minimizes browser)
    document.addEventListener('visibilitychange', visibilityChangeHandler)

    // beforeunload as a fallback for older browsers
    window.addEventListener('beforeunload', beforeunloadHandler)
  }

  // Return cleanup function
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', pagehideHandler)
      document.removeEventListener('visibilitychange', visibilityChangeHandler)
      window.removeEventListener('beforeunload', beforeunloadHandler)
    }
  }
}

/**
 * Checks if the browser supports navigator.sendBeacon API
 */
export function supportsSendBeacon(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function'
  )
}

import { BKTException } from './BKTExceptions'

/**
 * - `INITIALIZING`: no sync result yet. It can last after `initializeBKTClient()`
 *   finishes: when the first fetch fails, the state stays `INITIALIZING` until
 *   a sync succeeds, or polling fails after its retries.
 * - `SYNCED`: the last sync with the server worked. In polling mode, flag values
 *   can be up to `pollingInterval` old.
 * - `FAILING`: the SDK cannot get fresh flag values right now. It keeps retrying,
 *   and the app keeps the cached values. `lastError` says why. It is set when
 *   polling has used up its retries, or when initialization fails for a
 *   reason other than the request (for example a custom `storageFactory` that
 *   throws). A stream problem alone never sets `FAILING`: when the stream
 *   stops, polling takes over, and only its results count.
 * - `DESTROYED`: `destroyBKTClient()` was called. Sent once to listeners.
 */
export type BKTEvaluationSyncState =
  | 'INITIALIZING'
  | 'SYNCED'
  | 'FAILING'
  | 'DESTROYED'

/**
 * A failed sync. Failures come from polling (also the polling fallback while
 * streaming is down). A failed first fetch at init or a failed
 * `client.fetchEvaluations()` does not change the status: only polling
 * reports a failure, after its retries.
 */
export interface BKTEvaluationSyncError {
  readonly cause: BKTException
  /** Epoch milliseconds. */
  readonly occurredAt: number
}

export interface BKTEvaluationSyncStatus {
  readonly state: BKTEvaluationSyncState
  /** Epoch milliseconds of the last state change. */
  readonly changedAt: number
  /**
   * Epoch milliseconds of the last time the SDK confirmed the flag values are
   * current. `null` means never.
   * With streaming, stream heartbeats also move it while the stream is healthy.
   */
  readonly lastSyncedAt: number | null
  /** The last error. It is kept after recovery. `null` means no error yet. */
  readonly lastError: BKTEvaluationSyncError | null
}

export type BKTEvaluationSyncStatusListener = (
  status: BKTEvaluationSyncStatus,
) => void

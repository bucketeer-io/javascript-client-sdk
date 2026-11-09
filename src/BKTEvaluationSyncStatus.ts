import { BKTException } from './BKTExceptions'

/**
 * - `INITIALIZING`: `initializeBKTClient()` has not finished yet.
 * - `SYNCED`: the last sync with the server worked. In polling mode, flag values
 *   can be up to `pollingInterval` old.
 * - `FAILING`: the SDK cannot get fresh flag values right now. It keeps retrying,
 *   and the app keeps the cached values. `lastError` says why.
 * - `DESTROYED`: `destroyBKTClient()` was called. Sent once to listeners.
 */
export type BKTEvaluationSyncState =
  | 'INITIALIZING'
  | 'SYNCED'
  | 'FAILING'
  | 'DESTROYED'

/**
 * - `POLLING`: the get_evaluations request. This covers polling, the polling
 *   fallback while streaming is down, the first fetch at init, and
 *   `client.fetchEvaluations()`.
 * - `STREAMING`: the stream_evaluations stream (only when `enableStreaming` is true).
 */
export type BKTEvaluationSyncSource = 'POLLING' | 'STREAMING'

export interface BKTEvaluationSyncError {
  readonly cause: BKTException
  /** Epoch milliseconds. */
  readonly occurredAt: number
  readonly source: BKTEvaluationSyncSource
}

export interface BKTEvaluationSyncStatus {
  readonly state: BKTEvaluationSyncState
  /** Epoch milliseconds of the last state change. */
  readonly changedAt: number
  /**
   * Epoch milliseconds of the last time the SDK confirmed the flag values are
   * current. `null` means never.
   */
  readonly lastSyncedAt: number | null
  /** The last error. It is kept after recovery. `null` means no error yet. */
  readonly lastError: BKTEvaluationSyncError | null
}

export type BKTEvaluationSyncStatusListener = (
  status: BKTEvaluationSyncStatus,
) => void

import { BKTEvaluationSyncSource } from '../../BKTEvaluationSyncStatus'
import { BKTException } from '../../BKTExceptions'

// What StreamingTask needs: report the stream facts only it knows.
export interface StreamingSyncReporter {
  // A put or patch arrived with a valid payload.
  reportSuccess(source: BKTEvaluationSyncSource): void
  // Only when the stream gives up. A STREAMING failure is applied
  // STREAM_GIVE_UP_WAIT_MILLIS later.
  reportFailure(source: BKTEvaluationSyncSource, error: BKTException): void
  // A connection try failed, or the server sent an error event. Reports
  // nothing: stream bytes stop moving lastSyncedAt until the next put/patch.
  markStreamNotWorking(): void
  // Bytes arrived on the stream (data or a heartbeat).
  reportStreamingAlive(): void
  setPollingFallbackActive(active: boolean): void
}

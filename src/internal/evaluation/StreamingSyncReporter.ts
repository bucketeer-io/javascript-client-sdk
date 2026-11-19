import { BKTEvaluationSyncSource } from '../../BKTEvaluationSyncStatus'
import { BKTException } from '../../BKTExceptions'

// What StreamingTask needs: report the stream facts only it knows.
export interface StreamingSyncReporter {
  reportFailure(source: BKTEvaluationSyncSource, error: BKTException): void
  // Bytes arrived on the stream (data or a heartbeat).
  reportStreamingAlive(): void
  setPollingFallbackActive(active: boolean): void
}

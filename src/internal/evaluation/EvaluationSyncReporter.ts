import { BKTEvaluationSyncSource } from '../../BKTEvaluationSyncStatus'
import { BKTException } from '../../BKTExceptions'

// What the polling flows need (EvaluationTask, BKTClient init and
// fetchEvaluations()): report the result of a poll.
export interface EvaluationSyncReporter {
  reportSuccess(source: BKTEvaluationSyncSource): void
  reportFailure(source: BKTEvaluationSyncSource, error: BKTException): void
}

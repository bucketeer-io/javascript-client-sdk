import { BKTEvaluationSyncSource } from '../../BKTEvaluationSyncStatus'
import { BKTException } from '../../BKTExceptions'

// What EvaluationInteractor needs: report the result of a sync it already handles.
export interface EvaluationSyncReporter {
  reportSuccess(source: BKTEvaluationSyncSource): void
  reportFailure(source: BKTEvaluationSyncSource, error: BKTException): void
}

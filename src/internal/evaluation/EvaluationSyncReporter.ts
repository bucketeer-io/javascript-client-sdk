import { BKTException } from '../../BKTExceptions'

// What the polling flows need (EvaluationTask, BKTClient init and
// fetchEvaluations()): report the result of a poll.
export interface EvaluationSyncReporter {
  reportSuccess(): void
  reportFailure(error: BKTException): void
}

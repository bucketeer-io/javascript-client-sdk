import { BKTValue } from './BKTValue'

export interface BKTEvaluationDetails<T extends BKTValue> {
  readonly featureId: string
  readonly featureVersion: number
  readonly userId: string
  readonly variationId: string
  readonly variationName: string
  readonly variationValue: T
  readonly reason:
    | 'TARGET'
    | 'RULE'
    | 'DEFAULT'
    | 'CLIENT'
    | 'OFF_VARIATION'
    | 'PREREQUISITE'
}

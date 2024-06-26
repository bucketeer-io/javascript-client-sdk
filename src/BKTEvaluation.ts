/**
 * @deprecated use BKTEvaluationDetail<T> instead.
 */
export interface BKTEvaluation {
  readonly id: string
  readonly featureId: string
  readonly featureVersion: number
  readonly userId: string
  readonly variationId: string
  readonly variationName: string
  readonly variationValue: string
  readonly reason:
    | 'TARGET'
    | 'RULE'
    | 'DEFAULT'
    | 'CLIENT'
    | 'OFF_VARIATION'
    | 'PREREQUISITE'
}

export interface BKTEvaluationDetail<T> {
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

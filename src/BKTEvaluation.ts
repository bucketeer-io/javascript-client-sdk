/**
 * @deprecated use BKTEvaluationDetails<T> instead.
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
    | 'OFF_VARIATION'
    | 'PREREQUISITE'
    | 'CLIENT'
    // Although this interface is deprecated, we keep these new error values for backward compatibility
    | 'ERROR_FLAG_NOT_FOUND'
    | 'ERROR_WRONG_TYPE'
    | 'ERROR_EXCEPTION'
    | 'ERROR_NO_EVALUATIONS'
    | 'ERROR_USER_ID_NOT_SPECIFIED'
    | 'ERROR_FEATURE_FLAG_ID_NOT_SPECIFIED'
    | 'ERROR_CACHE_NOT_FOUND'
}

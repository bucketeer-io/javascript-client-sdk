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
    /** @deprecated Use error-specific reasons (ERROR_FLAG_NOT_FOUND, ERROR_WRONG_TYPE, etc.) instead */
    | 'CLIENT'
    // Although this interface is deprecated, we include these new error values to maintain consistency with BKTEvaluationDetails 
    // and support detailed error reporting for existing code still using this interface.
    | 'ERROR_FLAG_NOT_FOUND'
    | 'ERROR_WRONG_TYPE'
    | 'ERROR_EXCEPTION'
    | 'ERROR_NO_EVALUATIONS'
    | 'ERROR_USER_ID_NOT_SPECIFIED'
    | 'ERROR_FEATURE_FLAG_ID_NOT_SPECIFIED'
    | 'ERROR_CACHE_NOT_FOUND'
}

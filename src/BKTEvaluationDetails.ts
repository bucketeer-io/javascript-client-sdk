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
    | 'OFF_VARIATION'
    | 'PREREQUISITE'
    /** @deprecated Use error-specific reasons (ERROR_FLAG_NOT_FOUND, ERROR_WRONG_TYPE, etc.) instead */
    | 'CLIENT'
    | 'ERROR_FLAG_NOT_FOUND'
    | 'ERROR_WRONG_TYPE'
    | 'ERROR_EXCEPTION'
    | 'ERROR_NO_EVALUATIONS'
    | 'ERROR_USER_ID_NOT_SPECIFIED'
    | 'ERROR_FEATURE_FLAG_ID_NOT_SPECIFIED'
    | 'ERROR_CACHE_NOT_FOUND'
}

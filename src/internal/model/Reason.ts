/**
 * Reason types for feature flag evaluations.
 * 
 * Success reasons (evaluation found):
 * - TARGET: Evaluated using individual targeting
 * - RULE: Evaluated using a custom rule
 * - DEFAULT: Evaluated using the default strategy
 * - OFF_VARIATION: Evaluated using the off variation
 * - PREREQUISITE: Evaluated using a prerequisite
 * 
 * Error reasons (evaluation failed):
 * - ERROR_FLAG_NOT_FOUND: The specified feature flag was not found
 * - ERROR_WRONG_TYPE: The variation type does not match the expected type
 * - ERROR_EXCEPTION: An unexpected error occurred during evaluation
 * - ERROR_NO_EVALUATIONS: No evaluations were performed
 * - ERROR_USER_ID_NOT_SPECIFIED: User ID was not specified
 * - ERROR_FEATURE_FLAG_ID_NOT_SPECIFIED: Feature flag ID was not specified
 * - ERROR_CACHE_NOT_FOUND: The cache is not ready after SDK initialization
 * 
 * Deprecated:
 * - CLIENT: Use error-specific reasons instead
 */
export type ReasonType =
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

export interface Reason {
  type: ReasonType
  ruleId?: string
}

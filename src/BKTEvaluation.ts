export interface BKTEvaluation {
  readonly id: string
  readonly featureId: string
  readonly featureVersion: number
  readonly userId: string
  readonly variationId: string
  readonly variationValue: string
  readonly reason: 'TARGET' | 'RULE' | 'DEFAULT' | 'CLIENT' | 'OFF_VARIATION' | 'PREREQUISITE'
}

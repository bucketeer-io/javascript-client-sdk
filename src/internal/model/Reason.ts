const ReasonTypeValue = ['TARGET', 'RULE', 'DEFAULT', 'CLIENT', 'OFF_VARIATION', 'PREREQUISITE'] as const
export type ReasonType = (typeof ReasonTypeValue)[number]

export interface Reason {
  type: ReasonType
  ruleId?: string
}


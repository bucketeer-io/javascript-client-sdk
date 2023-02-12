import { Reason } from './Reason'
import { Variation } from './Variation'

export interface Evaluation {
  id: string
  featureId: string
  featureVersion: number
  userId: string
  variationId: string
  variation: Variation
  reason: Reason
  variationValue: string
}

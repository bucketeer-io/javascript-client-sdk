import { Reason } from './Reason'

export interface Evaluation {
  id: string
  featureId: string
  featureVersion: number
  userId: string
  variationId: string
  variationName: string
  variationValue: string
  reason: Reason
}

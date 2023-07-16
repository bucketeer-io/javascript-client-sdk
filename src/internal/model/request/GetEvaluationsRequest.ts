import { SourceID } from '../SourceID'
import { User } from '../User'

interface UserEvaluationCondition {
  evaluatedAt: number
  userAttributesUpdated: boolean
}

export interface GetEvaluationsRequest {
  tag: string
  user: User
  userEvaluationsId: string
  sourceId: SourceID
  userEvaluationCondition: UserEvaluationCondition
  sdkVersion: string
}

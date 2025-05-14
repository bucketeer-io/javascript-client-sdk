import { SourceId } from '../SourceId'
import { User } from '../User'

interface UserEvaluationCondition {
  // This can be a number, but `UserEvaluations.createdAt` is returned as string and is defined as int64, so we use string here.
  evaluatedAt: string
  userAttributesUpdated: boolean
}

export interface GetEvaluationsRequest {
  tag: string
  user: User
  userEvaluationsId: string
  sourceId: SourceId
  userEvaluationCondition: UserEvaluationCondition
  sdkVersion: string
}

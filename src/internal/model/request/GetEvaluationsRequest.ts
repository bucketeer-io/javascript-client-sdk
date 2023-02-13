import { SourceID } from '../SourceID'
import { User } from '../User'

export interface GetEvaluationsRequest {
  tag: string
  user: User
  userEvaluationsId: string
  sourceId: SourceID
}

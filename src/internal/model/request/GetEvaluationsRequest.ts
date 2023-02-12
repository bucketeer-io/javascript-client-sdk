import { SourceID } from '../SourceID'
import { User } from '../User'

export interface GetEvaluationsRequest {
  tag: string
  user: User
  user_evaluations_id: string
  source_id: SourceID
}

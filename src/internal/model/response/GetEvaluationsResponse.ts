import { UserEvaluations } from '../UserEvaluations'

export interface GetEvaluationsResponse {
  evaluations: UserEvaluations
  userEvaluationsId: string
}

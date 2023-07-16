import { Evaluation } from './Evaluation'

export interface UserEvaluations {
  id: string
  evaluations?: Evaluation[]
  createdAt: number
  archivedFeatureIds: string[]
  forceUpdate: boolean
}

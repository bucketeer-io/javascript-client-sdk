import { IdGenerator } from '../IdGenerator'
import { Evaluation } from '../model/Evaluation'
import { User } from '../model/User'
import { ApiClient } from '../remote/ApiClient'
import { GetEvaluationsResult } from '../remote/GetEvaluationsResult'
import { EvaluationStorage } from './EvaluationStorage'

export class EvaluationInteractor {
  constructor(
    private apiClient: ApiClient,
    private evaluationStorage: EvaluationStorage,
    private idGenerator: IdGenerator,
  ) { }

  // visible for testing. should only be accessed from test code
  updateListeners: Record<string, () => void> = {}

  async fetch(user: User, timeoutMillis?: number): Promise<GetEvaluationsResult> {
    const currentEvaluationsId = this.evaluationStorage.getCurrentEvaluationsId() ?? ''

    const result = await this.apiClient.getEvaluations(user, currentEvaluationsId, timeoutMillis)

    if (result.type === 'success') {
      const response = result.value
      const newEvaluationId = response.userEvaluationsId

      if (currentEvaluationsId === newEvaluationId) {
        // evaluations are up-to-date
        return result
      }

      this.evaluationStorage.deleteAllAndInsert(
        response.userEvaluationsId,
        response.evaluations.evaluations ?? []
      )

      Object.values(this.updateListeners).forEach(listener => listener())
    }

    return result
  }

  getLatest(featureId: string): Evaluation | null {
    return this.evaluationStorage.getByFeatureId(featureId)
  }

  addUpdateListener(listener: () => void): string {
    const id = this.idGenerator.newId()
    this.updateListeners[id] = listener
    return id
  }

  removeUpdateListener(id: string): void {
    delete this.updateListeners[id]
  }

  clearUpdateListeners(): void {
    this.updateListeners = {}
  }
}

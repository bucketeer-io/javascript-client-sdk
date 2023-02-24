import { EvaluationInteractor } from '../evaluation/EvaluationInteractor'
import { EvaluationStorage } from '../evaluation/EvaluationStorage'
import { IdGenerator } from '../IdGenerator'
import { ApiClient } from '../remote/ApiClient'

export class InteractorModule {
  evaluationInteractor(
    apiClient: ApiClient,
    evaluationStorage: EvaluationStorage,
    idGenerator: IdGenerator,
  ): EvaluationInteractor {
    return new EvaluationInteractor(
      apiClient,
      evaluationStorage,
      idGenerator,
    )
  }
}

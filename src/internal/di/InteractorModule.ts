import { Clock } from '../Clock'
import { EvaluationInteractor } from '../evaluation/EvaluationInteractor'
import { EvaluationStorage } from '../evaluation/EvaluationStorage'
import { EventInteractor } from '../event/EventInteractor'
import { EventStorage } from '../event/EventStorage'
import { IdGenerator } from '../IdGenerator'
import { ApiClient } from '../remote/ApiClient'

export class InteractorModule {
  evaluationInteractor(
    apiClient: ApiClient,
    evaluationStorage: EvaluationStorage,
    idGenerator: IdGenerator,
  ): EvaluationInteractor {
    return new EvaluationInteractor(apiClient, evaluationStorage, idGenerator)
  }

  eventInteractor(
    eventsMaxBatchQueueCount: number,
    apiClient: ApiClient,
    eventStorage: EventStorage,
    idGenerator: IdGenerator,
    clock: Clock,
    appVersion: string,
  ): EventInteractor {
    return new EventInteractor(
      eventsMaxBatchQueueCount,
      apiClient,
      eventStorage,
      clock,
      idGenerator,
      appVersion,
    )
  }
}

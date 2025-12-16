import { Clock } from '../Clock'
import { EvaluationInteractor } from '../evaluation/EvaluationInteractor'
import { EvaluationStorage } from '../evaluation/EvaluationStorage'
import { EventInteractor } from '../event/EventInteractor'
import { EventStorage } from '../event/EventStorage'
import { IdGenerator } from '../IdGenerator'
import { SourceId } from '../model/SourceId'
import { ApiClient } from '../remote/ApiClient'

export class InteractorModule {
  evaluationInteractor(
    featureTag: string,
    apiClient: ApiClient,
    evaluationStorage: EvaluationStorage,
    idGenerator: IdGenerator,
  ): EvaluationInteractor {
    return new EvaluationInteractor(
      featureTag,
      apiClient,
      evaluationStorage,
      idGenerator,
    )
  }

  eventInteractor(
    eventsMaxBatchQueueCount: number,
    apiClient: ApiClient,
    eventStorage: EventStorage,
    idGenerator: IdGenerator,
    clock: Clock,
    appVersion: string,
    userAgent: string,
    sourceId: SourceId,
    sdkVersion: string,
    evaluationDedupWindowMillis: number,
  ): EventInteractor {
    return new EventInteractor(
      eventsMaxBatchQueueCount,
      apiClient,
      eventStorage,
      clock,
      idGenerator,
      appVersion,
      userAgent,
      sourceId,
      sdkVersion,
      evaluationDedupWindowMillis,
    )
  }
}

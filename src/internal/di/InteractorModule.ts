import { Clock } from '../Clock'
import { EvaluationInteractor } from '../evaluation/EvaluationInteractor'
import { EvaluationStorage } from '../evaluation/EvaluationStorage'
import { EventInteractor } from '../event/EventInteractor'
import { EventStorage } from '../event/EventStorage'
import { IdGenerator } from '../IdGenerator'
import { SourceID } from '../model/SourceID'
import { ApiClient } from '../remote/ApiClient'

export class InteractorModule {
  evaluationInteractor(
    featureTag: string,
    apiClient: ApiClient,
    evaluationStorage: EvaluationStorage,
    idGenerator: IdGenerator,
    sourceId: SourceID,
    sdkVersion: string,
  ): EvaluationInteractor {
    return new EvaluationInteractor(
      featureTag,
      apiClient,
      evaluationStorage,
      idGenerator,
      sourceId,
      sdkVersion,
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
    sourceId: SourceID,
    sdkVersion: string,
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
    )
  }
}

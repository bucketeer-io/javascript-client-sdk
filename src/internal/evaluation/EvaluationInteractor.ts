import { IdGenerator } from '../IdGenerator'
import { Evaluation } from '../model/Evaluation'
import { User } from '../model/User'
import { GetEvaluationsResponse } from '../model/response/GetEvaluationsResponse'
import { ApiClient } from '../remote/ApiClient'
import { GetEvaluationsResult } from '../remote/GetEvaluationsResult'
import { EvaluationStorage } from './EvaluationStorage'

export class EvaluationInteractor {
  constructor(
    private featureTag: string,
    private apiClient: ApiClient,
    private evaluationStorage: EvaluationStorage,
    private idGenerator: IdGenerator,
  ) {}

  // visible for testing. should only be accessed from test code
  updateListeners: Record<string, () => void> = {}

  // Important: should call this method before using the interactor.
  async initialize(): Promise<void> {
    // This method is used to initialize the interactor internally.
    // It can be used to perform any setup required before using the interactor.
    await this.evaluationStorage.initialize()
    // check if the new featureTag is different from the saved one
    // If the featureTag is different, update it in the storage and clear currentEvaluationsId
    await this.evaluationStorage.updateFeatureTag(this.featureTag)
  }

  async fetch(
    user: User,
    timeoutMillis?: number,
  ): Promise<GetEvaluationsResult> {
    const currentEvaluationsId =
      await this.evaluationStorage.getCurrentEvaluationsId() ?? ''
    const evaluatedAt = await this.evaluationStorage.getEvaluatedAt() ?? '0'
    const userAttributesUpdated = await
            this.evaluationStorage.getUserAttributesUpdated()
    const result = await this.apiClient.getEvaluations(
      {
        user,
        userEvaluationsId: currentEvaluationsId,
        userEvaluationCondition: {
          evaluatedAt: evaluatedAt,
          userAttributesUpdated: userAttributesUpdated,
        },
        tag: this.featureTag,
      },
      timeoutMillis,
    )

    if (result.type === 'success') {
      await this.applyEvaluationsResponse(result.value)
      // Only the polling/fetch path clears the flag: this request carried the
      // current user attributes. Streamed data must never clear it (race).
      await this.evaluationStorage.clearUserAttributesUpdated()
    }

    return result
  }

  async applyEvaluationsResponse(
    response: GetEvaluationsResponse,
  ): Promise<void> {
    let shouldNotify: boolean
    if (response.evaluations.forceUpdate) {
      await this.evaluationStorage.deleteAllAndInsert(
        response.userEvaluationsId,
        response.evaluations.evaluations ?? [],
        response.evaluations.createdAt,
      )
      shouldNotify = true
    } else {
      shouldNotify = await this.evaluationStorage.update(
        response.userEvaluationsId,
        response.evaluations.evaluations ?? [],
        response.evaluations.archivedFeatureIds ?? [],
        response.evaluations.createdAt,
      )
    }

    if (shouldNotify) {
      Object.values(this.updateListeners).forEach((listener) => listener())
    }
  }

  getLatest(featureId: string): Evaluation | null {
    return this.evaluationStorage.getByFeatureId(featureId)
  }

  // Used by StreamingTask.buildRequest() to send the last-known state on
  // every (re)connect, so the backend can reply with a diff instead of a
  // full snapshot. Throws before initialize() — see the comment on
  // EvaluationStorage.getCurrentEvaluationsCondition().
  getCurrentEvaluationsCondition(): {
    currentEvaluationsId: string | null
    evaluatedAt: string | null
  } {
    return this.evaluationStorage.getCurrentEvaluationsCondition()
  }

  async setUserAttributesUpdated(): Promise<void> {
    return this.evaluationStorage.setUserAttributesUpdated()
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

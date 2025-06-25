import { IdGenerator } from '../IdGenerator'
import { Evaluation } from '../model/Evaluation'
import { User } from '../model/User'
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
      const response = result.value

      let shouldNotify: boolean
      if (response.evaluations.forceUpdate) {
        // 1- Delete all the evaluations from local storage, and save the latest evaluations from the response into the local storage
        // 2- Save the UserEvaluations.CreatedAt in the response as evaluatedAt in the localStorage
        await this.evaluationStorage.deleteAllAndInsert(
          response.userEvaluationsId,
          response.evaluations.evaluations ?? [],
          response.evaluations.createdAt,
        )
        shouldNotify = true
      } else {
        // 1- Check the evaluation list in the response and upsert them in the localStorage if the list is not empty
        // 2- Check the archivedFeatureIds list and delete them from the localStorage if is not empty
        // 3- Save the UserEvaluations.CreatedAt in the response as evaluatedAt in the localStorage
        shouldNotify = await this.evaluationStorage.update(
          response.userEvaluationsId,
          response.evaluations.evaluations ?? [],
          response.evaluations.archivedFeatureIds ?? [],
          response.evaluations.createdAt,
        )
      }

      await this.evaluationStorage.clearUserAttributesUpdated()

      if (shouldNotify) {
        Object.values(this.updateListeners).forEach((listener) => listener())
      }
    }

    return result
  }

  getLatest(featureId: string): Evaluation | null {
    return this.evaluationStorage.getByFeatureId(featureId)
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

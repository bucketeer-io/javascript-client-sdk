import { IdGenerator } from '../IdGenerator'
import { Evaluation } from '../model/Evaluation'
import { User } from '../model/User'
import { GetEvaluationsResponse } from '../model/response/GetEvaluationsResponse'
import { ApiClient } from '../remote/ApiClient'
import { GetEvaluationsResult } from '../remote/GetEvaluationsResult'
import { EvaluationStorage, UserAttributesState } from './EvaluationStorage'

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
    // Captured before the request as one snapshot so a concurrent
    // setUserAttributesUpdated() that lands while this request is in flight
    // is detected below — see EvaluationStorage.clearUserAttributesUpdated().
    const attributesStateAtStart = this.evaluationStorage.getUserAttributesState()
    const result = await this.apiClient.getEvaluations(
      {
        user,
        userEvaluationsId: currentEvaluationsId,
        userEvaluationCondition: {
          evaluatedAt: evaluatedAt,
          userAttributesUpdated: attributesStateAtStart.userAttributesUpdated,
        },
        tag: this.featureTag,
      },
      timeoutMillis,
    )

    if (result.type === 'success') {
      // Clear BEFORE applying/notifying: applyEvaluationsResponse() fires
      // update listeners synchronously, and a listener that triggers a
      // nested fetch (refresh-on-change pattern) must observe the flag
      // already cleared — this request already carried it. Clearing after
      // notifying (as a naive refactor would) lets that nested call re-send
      // userAttributesUpdated:true and get back a redundant forceUpdate
      // snapshot. Streamed data must never clear it (race) — only this,
      // the polling/fetch path, does.
      await this.evaluationStorage.clearUserAttributesUpdated(
        attributesStateAtStart,
      )
      await this.applyEvaluationsResponse(result.value)
    }

    return result
  }

  async applyEvaluationsResponse(
    response: GetEvaluationsResponse,
    // shouldNotify is re-checked AFTER the storage write completes: the write
    // is awaited, so a stop()/destroy racing it must be able to suppress the
    // listener callbacks (which may run app code against a torn-down client).
    // The write itself is allowed to land — it's just unused cached data.
    options?: { shouldNotify?: () => boolean },
  ): Promise<void> {
    let changed: boolean
    if (response.evaluations.forceUpdate) {
      await this.evaluationStorage.deleteAllAndInsert(
        response.userEvaluationsId,
        response.evaluations.evaluations ?? [],
        response.evaluations.createdAt,
      )
      changed = true
    } else {
      changed = await this.evaluationStorage.update(
        response.userEvaluationsId,
        response.evaluations.evaluations ?? [],
        response.evaluations.archivedFeatureIds ?? [],
        response.evaluations.createdAt,
      )
    }

    if (changed && (options?.shouldNotify?.() ?? true)) {
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

  // Used by StreamingTask.buildRequest()/onOpen to capture the flag's state
  // at request-build time and clear it once the connection this request
  // built actually opens — see EvaluationStorage.clearUserAttributesUpdated().
  getUserAttributesState(): UserAttributesState {
    return this.evaluationStorage.getUserAttributesState()
  }

  async clearUserAttributesUpdated(state: UserAttributesState): Promise<void> {
    return this.evaluationStorage.clearUserAttributesUpdated(state)
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

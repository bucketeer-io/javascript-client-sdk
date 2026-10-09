import { IdGenerator } from '../IdGenerator'
import { Evaluation } from '../model/Evaluation'
import { User } from '../model/User'
import { GetEvaluationsResponse } from '../model/response/GetEvaluationsResponse'
import { ApiClient } from '../remote/ApiClient'
import { GetEvaluationsResult } from '../remote/GetEvaluationsResult'
import {
  EvaluationStorage,
  EvaluationWriteResult,
  UserAttributesState,
} from './EvaluationStorage'

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
    // Captured synchronously as the FIRST statement, before any await: the
    // caller reads `user` in the same synchronous expression that invokes
    // fetch(), so capturing here makes the user snapshot and this state
    // snapshot atomic. Captured after an await instead, a
    // setUserAttributesUpdated() landing in that gap would stamp this request
    // with a sequence for attributes the request's user object doesn't carry —
    // and the success-path clear below would then wipe a flag whose
    // attributes were never sent. See EvaluationStorage.
    // clearUserAttributesUpdated().
    const attributesStateAtStart = this.evaluationStorage.getUserAttributesState()
    const currentEvaluationsId =
      await this.evaluationStorage.getCurrentEvaluationsId() ?? ''
    const evaluatedAt = await this.evaluationStorage.getEvaluatedAt() ?? '0'
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
      // Ordering carries two invariants. Write BEFORE clear: the response to
      // a userAttributesUpdated:true request carries the re-evaluation the
      // flag asked for, so a write that throws or is skipped as stale must
      // skip the clear. The flag survives and the next poll asks again.
      // Clear BEFORE notify: a listener that triggers a nested fetch
      // (refresh-on-change pattern) must observe the flag already cleared
      // (this request already carried it), or the nested call re-sends
      // userAttributesUpdated:true and gets back a redundant forceUpdate
      // snapshot. Streamed payloads never clear the flag (race); on the
      // stream side, only StreamingTask's onOpen clears it, when a
      // connection opens.
      const writeResult = await this.writeEvaluations(result.value)
      if (writeResult.type === 'skippedStale') {
        return result
      }
      await this.evaluationStorage.clearUserAttributesUpdated(
        attributesStateAtStart,
      )
      if (writeResult.shouldNotify) {
        this.notifyListeners()
      }
    }

    return result
  }

  async applyEvaluationsResponse(
    response: GetEvaluationsResponse,
    // shouldNotify is re-checked AFTER the storage write completes: the write
    // is awaited, so a stop()/destroy racing it must be able to suppress the
    // listener callbacks (which may run app code against a torn-down client).
    // The write itself is allowed to land — it's just unused cached data.
    shouldNotify: () => boolean = () => true,
  ): Promise<void> {
    const writeResult = await this.writeEvaluations(response)
    if (
      writeResult.type === 'landed' &&
      writeResult.shouldNotify &&
      shouldNotify()
    ) {
      this.notifyListeners()
    }
  }

  // @returns skippedStale when EvaluationStorage's staleness guard skipped the
  // write. Callers must not notify, and fetch() must not clear
  // userAttributesUpdated, in that case.
  private async writeEvaluations(
    response: GetEvaluationsResponse,
  ): Promise<EvaluationWriteResult> {
    if (response.evaluations.forceUpdate) {
      return this.evaluationStorage.deleteAllAndInsert(
        response.userEvaluationsId,
        response.evaluations.evaluations ?? [],
        response.evaluations.createdAt,
      )
    }
    return this.evaluationStorage.update(
      response.userEvaluationsId,
      response.evaluations.evaluations ?? [],
      response.evaluations.archivedFeatureIds ?? [],
      response.evaluations.createdAt,
    )
  }

  private notifyListeners(): void {
    Object.values(this.updateListeners).forEach((listener) => listener())
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

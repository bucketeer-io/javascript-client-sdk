import { Evaluation } from '../model/Evaluation'
import { BKTStorage } from '../../BKTStorage'
import { Mutex } from 'async-mutex'
import { runWithMutex } from '../mutex'

export interface EvaluationEntity {
  userId: string
  currentEvaluationsId: string | null
  evaluations: Record<string /* featureId */, Evaluation>
  currentFeatureTag: string | null
  evaluatedAt: string | null
  userAttributesUpdated: boolean
}

// Guards against a stale concurrent writer (e.g. the initial REST fetch
// racing the stream's first snapshot) rewinding state. Strictly older only —
// an equal evaluatedAt still applies, since two patches computed in the same
// clock tick are not stale relative to each other, and dropping an
// equal-timestamp write would be a worse failure than the race this guards
// against. `Number()` is safe for the observed decimal-millisecond-string
// format, far below 2^53.
function isStale(entity: EvaluationEntity, evaluatedAt: string): boolean {
  return (
    entity.evaluatedAt !== null &&
    Number(evaluatedAt) < Number(entity.evaluatedAt)
  )
}

/**
 * Snapshot of the userAttributesUpdated flag paired with the sequence number
 * it was read at. Mirrors the Android/iOS SDKs' UserAttributesState (same
 * field names, incl. updateSequence) — bundled into one value so callers
 * can't accidentally read the flag and sequence at inconsistent points. Pass
 * the whole snapshot back to clearUserAttributesUpdated() so a request built
 * from a stale snapshot can't clear a flag set by a later
 * setUserAttributesUpdated() call.
 */
export interface UserAttributesState {
  userAttributesUpdated: boolean
  updateSequence: number
}

export interface EvaluationStorage {
  getByFeatureId(featureId: string): Evaluation | null

  /**
   * Preload the storage from the underlying storage.
   * This is useful to ensure that the storage is ready before any operations.
   */
  initialize(): Promise<void>

  /**
   * @returns false (a no-op) if the incoming write is stale — see isStale()
   * for the full rule and rationale — otherwise true.
   */
  deleteAllAndInsert(
    evaluationsId: string,
    evaluations: Evaluation[],
    evaluatedAt: string,
  ): Promise<boolean>
  /**
   * @returns false if the incoming write is stale — see isStale() — otherwise
   * true iff something changed.
   */
  update(
    evaluationsId: string,
    evaluations: Evaluation[],
    archivedFeatureIds: string[],
    evaluatedAt: string,
  ): Promise<boolean>

  getCurrentEvaluationsId(): Promise<string | null>

  getEvaluatedAt(): Promise<string | null>

  /**
   * Synchronous cache read for the streaming request builder. Throws before
   * initialize(), same contract as getCurrentEvaluationsId() / getEvaluatedAt()
   * above — safe because BKTClientImpl.initializeInternal() guarantees
   * initialize() always resolves before any task (including StreamingTask's
   * first connect) can reach this storage. See the ordering comment on
   * initializeInternal() in BKTClient.ts before changing that guarantee.
   */
  getCurrentEvaluationsCondition(): {
    currentEvaluationsId: string | null
    evaluatedAt: string | null
  }

  /**
   * @returns true if featureTag has been updated
   */
  updateFeatureTag(featureTag: string): Promise<boolean>

  setUserAttributesUpdated(): Promise<void>

  /**
   * Synchronous cache read, same contract as getCurrentEvaluationsCondition()
   * above — deliberately not mutex-guarded. Two reasons: (1)
   * StreamingTask.buildRequest() must call this synchronously, with no
   * `await` anywhere in that call chain, so this can't become async; (2) a
   * synchronous read with no `await` inside it can't be interrupted by a
   * concurrent write in a single-threaded runtime, so no mutex is needed for
   * the read itself to be internally consistent. The tradeoff: it only
   * reflects a setUserAttributesUpdated() call once that call has been
   * awaited by its caller (not the instant it's called) — true today, since
   * the only real caller, BKTClient.updateUserAttributes(), always awaits it.
   * Capture the returned snapshot before starting a request and pass it back
   * to clearUserAttributesUpdated() so a stale in-flight request can't clear
   * a flag set by a later setUserAttributesUpdated() call.
   */
  getUserAttributesState(): UserAttributesState

  /**
   * No-ops if state.updateSequence no longer matches the current sequence,
   * i.e. a setUserAttributesUpdated() call happened after state was captured
   * — that means the caller's request didn't carry the latest attributes, so
   * the flag must survive for the next request to pick up.
   */
  clearUserAttributesUpdated(state: UserAttributesState): Promise<void>

  clear(): Promise<void>
}

export class EvaluationStorageImpl implements EvaluationStorage {
  constructor(
    public userId: string,
    public storage: BKTStorage<EvaluationEntity>,
  ) { }
  
  private mutex = new Mutex()

  /**
   * Cached evaluation entity for fast access.
   * It is initialized to null, meaning that the storage has not been loaded yet.
   * It is set to null when the storage is cleared.
   */
  public cacheEvaluationEntity: EvaluationEntity | null = null

  /**
   * In-memory only (no persistence/migration needed) — bumped by every
   * setUserAttributesUpdated() call. See clearUserAttributesUpdated().
   */
  private updateSequence = 0

  async initialize(): Promise<void> {
    if (this.cacheEvaluationEntity) {
      throw new Error(
        'Evaluation storage is already initialized. Call clear() to reset.',
      )
    }
    this.cacheEvaluationEntity = await this.getInternal(this.userId)
  }

  private getCachedEvaluationEntity(): EvaluationEntity {
    if (this.cacheEvaluationEntity === null) {
      throw new Error(
        'Cache Evaluation entity is not loaded. Call initialize() first.',
      )
    }
    return this.cacheEvaluationEntity
  }

  /**
   * Save the evaluation entity to the storage.
   * Also updates the cached entity.
   */
  private async saveAsync(entity: EvaluationEntity): Promise<void> {
    this.cacheEvaluationEntity = entity
    await this.storage.set(entity)
  }

  getByFeatureId(featureId: string): Evaluation | null {
    const entity = this.getCachedEvaluationEntity()
    return entity.evaluations[featureId] ?? null
  }

  async deleteAllAndInsert(
    evaluationsId: string,
    evaluations: Evaluation[],
    evaluatedAt: string,
  ): Promise<boolean> {
    return await runWithMutex(this.mutex, async () => {
      const entity = this.getCachedEvaluationEntity()
      if (isStale(entity, evaluatedAt)) return false
      const updated: EvaluationEntity = {
        ...entity,
        userId: this.userId,
        currentEvaluationsId: evaluationsId,
        evaluations: evaluations.reduce<EvaluationEntity['evaluations']>(
          (acc, cur) => {
            return { ...acc, [cur.featureId]: cur }
          },
          {},
        ),
        evaluatedAt,
      }
      await this.saveAsync(updated)
      return true
    })
  }

  async update(
    evaluationsId: string,
    evaluations: Evaluation[],
    archivedFeatureIds: string[],
    evaluatedAt: string,
  ): Promise<boolean> {
    return await runWithMutex(this.mutex, async () => {
      const entity = this.getCachedEvaluationEntity()
      if (isStale(entity, evaluatedAt)) return false

      // remove archived evaluations
      const activeEvaluations = Object.fromEntries(
        Object.entries(entity.evaluations).filter(
          ([key]) => !archivedFeatureIds.includes(key),
        ),
      )

      // update/add evaluations
      evaluations.forEach((ev) => {
        activeEvaluations[ev.featureId] = ev
      })

      await this.saveAsync({
        ...entity,
        currentEvaluationsId: evaluationsId,
        evaluations: activeEvaluations,
        evaluatedAt,
      })

      return (
        entity.currentEvaluationsId !== evaluationsId ||
        evaluations.length > 0 ||
        archivedFeatureIds.length > 0
      )
    })
  }

  async getCurrentEvaluationsId(): Promise<string | null> {
    return this.getCachedEvaluationEntity().currentEvaluationsId
  }

  async getEvaluatedAt(): Promise<string | null> {
    return this.getCachedEvaluationEntity().evaluatedAt
  }

  getCurrentEvaluationsCondition(): {
    currentEvaluationsId: string | null
    evaluatedAt: string | null
  } {
    const entity = this.getCachedEvaluationEntity()
    return {
      currentEvaluationsId: entity.currentEvaluationsId,
      evaluatedAt: entity.evaluatedAt,
    }
  }

  async updateFeatureTag(featureTag: string): Promise<boolean> {
    return await runWithMutex(this.mutex, async () => {
      const entity = this.getCachedEvaluationEntity()
      const changed = entity.currentFeatureTag !== featureTag

      if (changed) {
        await this.saveAsync({
          ...entity,
          currentFeatureTag: featureTag,
          currentEvaluationsId: null,
        })
      }

      return changed
    })
  }

  async setUserAttributesUpdated(): Promise<void> {
    await runWithMutex(this.mutex, async () => {
      const entity = this.getCachedEvaluationEntity()
      this.updateSequence++
      await this.saveAsync({
        ...entity,
        userAttributesUpdated: true,
      })
    })
  }

  getUserAttributesState(): UserAttributesState {
    const entity = this.getCachedEvaluationEntity()
    return {
      userAttributesUpdated: entity.userAttributesUpdated,
      updateSequence: this.updateSequence,
    }
  }

  async clearUserAttributesUpdated(state: UserAttributesState): Promise<void> {
    await runWithMutex(this.mutex, async () => {
      const entity = this.getCachedEvaluationEntity()
      if (this.updateSequence !== state.updateSequence) {
        // A setUserAttributesUpdated() call landed after state was captured
        // — this clear belongs to a now-stale request that didn't carry the
        // latest attributes. Leave the flag set for the next request.
        return
      }
      if (!entity.userAttributesUpdated) {
        // Already false — the common case on every (re)connect/poll. Skip the
        // write instead of re-serializing the whole evaluations map to set
        // false → false.
        return
      }
      await this.saveAsync({
        ...entity,
        userAttributesUpdated: false,
      })
    })
  }

  async clear(): Promise<void> {
    await runWithMutex(this.mutex, async () => {
      await this.storage.clear()
      this.cacheEvaluationEntity = null
    })
  }

  private async getInternal(userId: string): Promise<EvaluationEntity> {
    const entity = await this.storage.get()
    if (!entity || entity.userId !== userId) {
      // entity doesn't exist or userId is different
      return {
        userId,
        currentEvaluationsId: null,
        evaluations: {},
        evaluatedAt: null,
        currentFeatureTag: null,
        userAttributesUpdated: false,
      }
    }
    return entity
  }
}

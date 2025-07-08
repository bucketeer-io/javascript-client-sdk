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

export interface EvaluationStorage {
  getByFeatureId(featureId: string): Evaluation | null

  /**
   * Preload the storage from the underlying storage.
   * This is useful to ensure that the storage is ready before any operations.
   */
  initialize(): Promise<void>

  deleteAllAndInsert(
    evaluationsId: string,
    evaluations: Evaluation[],
    evaluatedAt: string,
  ): Promise<void>
  update(
    evaluationsId: string,
    evaluations: Evaluation[],
    archivedFeatureIds: string[],
    evaluatedAt: string,
  ): Promise<boolean>

  getCurrentEvaluationsId(): Promise<string | null>

  getEvaluatedAt(): Promise<string | null>

  /**
   * @returns true if featureTag has been updated
   */
  updateFeatureTag(featureTag: string): Promise<boolean>

  setUserAttributesUpdated(): Promise<void>
  getUserAttributesUpdated(): Promise<boolean>
  clearUserAttributesUpdated(): Promise<void>

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
  ): Promise<void> {
    await runWithMutex(this.mutex, async () => {
      const entity = this.getCachedEvaluationEntity()
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
      await this.saveAsync({
        ...entity,
        userAttributesUpdated: true,
      })
    })
  }

  async getUserAttributesUpdated(): Promise<boolean> {
    return await runWithMutex(this.mutex, async () => {
      const entity = this.getCachedEvaluationEntity()
      return entity.userAttributesUpdated
    })
  }

  async clearUserAttributesUpdated(): Promise<void> {
    await runWithMutex(this.mutex, async () => {
      const entity = this.getCachedEvaluationEntity()
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

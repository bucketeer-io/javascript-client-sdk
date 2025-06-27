import { Evaluation } from '../model/Evaluation'
import { BKTStorage } from '../../BKTStorage'

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

  getCurrentEvaluationsId(): string | null

  getEvaluatedAt(): string | null

  /**
   * @returns true if featureTag has been updated
   */
  updateFeatureTag(featureTag: string): Promise<boolean>

  setUserAttributesUpdated(): Promise<void>
  getUserAttributesUpdated(): boolean
  clearUserAttributesUpdated(): Promise<void>

  clear(): Promise<void>
}

export class EvaluationStorageImpl implements EvaluationStorage {
  constructor(
    public userId: string,
    public storage: BKTStorage<EvaluationEntity>,
  ) {}

  /**
   * Cached evaluation entity for fast access.
   * It is initialized to null, meaning that the storage has not been loaded yet.
   * It is set to null when the storage is cleared.
   */
  public cacheEvaluationEntity: EvaluationEntity | null = null

  async initialize(): Promise<void> {
    this.cacheEvaluationEntity = await this.getInternal(this.userId)
  }

  private getCachedEvaluationEntity(): EvaluationEntity {
    if (this.cacheEvaluationEntity === null) {
      throw new Error(
        'Cache Evaluation entity is not loaded. Call loadCache() first.',
      )
    }
    return this.cacheEvaluationEntity
  }

  /**
   * Save the evaluation entity to the storage.
   * Also updates the cached entity.
   */
  private async save(entity: EvaluationEntity): Promise<void> { 
    this.storage.set(entity)
    this.cacheEvaluationEntity = entity
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

    await this.save(updated)
  }

  async update(
    evaluationsId: string,
    evaluations: Evaluation[],
    archivedFeatureIds: string[],
    evaluatedAt: string,
  ): Promise<boolean> {
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

    await this.save({
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
  }

  getCurrentEvaluationsId(): string | null {
    return this.getCachedEvaluationEntity().currentEvaluationsId
  }

  getEvaluatedAt(): string | null {
    return this.getCachedEvaluationEntity().evaluatedAt
  }

  async updateFeatureTag(featureTag: string): Promise<boolean> {
    const entity = this.getCachedEvaluationEntity()
    const changed = entity.currentFeatureTag !== featureTag

    if (changed) {
      await this.save({
        ...entity,
        currentFeatureTag: featureTag,
        currentEvaluationsId: null,
      })
    }

    return changed
  }

  async setUserAttributesUpdated(): Promise<void> {
    const entity = this.getCachedEvaluationEntity()

    await this.save({
      ...entity,
      userAttributesUpdated: true,
    })
  }

  getUserAttributesUpdated(): boolean {
    return this.getCachedEvaluationEntity().userAttributesUpdated
  }

  async clearUserAttributesUpdated(): Promise<void> {
    const entity = this.getCachedEvaluationEntity()

    await this.save({
      ...entity,
      userAttributesUpdated: false,
    })
  }

  async clear(): Promise<void> {
    this.storage.clear()
    this.cacheEvaluationEntity = null
  }

  private async getInternal(userId: string): Promise<EvaluationEntity> {
    const entity = this.storage.get()
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

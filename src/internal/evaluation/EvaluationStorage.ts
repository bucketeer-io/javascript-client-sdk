import { Evaluation } from '../model/Evaluation'
import { BKTStorage } from '../../BKTStorage'

export interface EvaluationEntity {
  userId: string
  currentEvaluationsId: string | null
  evaluations: Record<string /* featureId */, Evaluation>
  currentFeatureTag: string | null
  evaluatedAt: number | null
  userAttributesUpdated: boolean
}

export interface EvaluationStorage {
  getByFeatureId(featureId: string): Evaluation | null

  deleteAllAndInsert(
    evaluationsId: string,
    evaluations: Evaluation[],
    evaluatedAt: number,
  ): void
  update(
    evaluationsId: string,
    evaluations: Evaluation[],
    archivedFeatureIds: string[],
    evaluatedAt: number,
  ): boolean

  getCurrentEvaluationsId(): string | null

  getEvaluatedAt(): number | null

  /**
   * @returns true if featureTag has been updated
   */
  updateFeatureTag(featureTag: string): boolean

  setUserAttributesUpdated(): void
  getUserAttributesUpdated(): boolean
  clearUserAttributesUpdated(): void

  clear(): void
}

export class EvaluationStorageImpl implements EvaluationStorage {
  constructor(
    public userId: string,
    public storage: BKTStorage<EvaluationEntity>,
  ) {}

  getByFeatureId(featureId: string): Evaluation | null {
    const entity = this.getInternal(this.userId)
    return entity.evaluations[featureId] ?? null
  }

  deleteAllAndInsert(
    evaluationsId: string,
    evaluations: Evaluation[],
    evaluatedAt: number,
  ): void {
    const entity = this.getInternal(this.userId)
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

    this.storage.set(updated)
  }

  update(
    evaluationsId: string,
    evaluations: Evaluation[],
    archivedFeatureIds: string[],
    evaluatedAt: number,
  ): boolean {
    const entity = this.getInternal(this.userId)

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

    this.storage.set({
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
    return this.getInternal(this.userId).currentEvaluationsId
  }

  getEvaluatedAt(): number | null {
    return this.getInternal(this.userId).evaluatedAt
  }

  updateFeatureTag(featureTag: string): boolean {
    const entity = this.getInternal(this.userId)
    const changed = entity.currentFeatureTag !== featureTag

    if (changed) {
      this.storage.set({
        ...entity,
        currentFeatureTag: featureTag,
        currentEvaluationsId: null,
      })
    }

    return changed
  }

  setUserAttributesUpdated(): void {
    const entity = this.getInternal(this.userId)

    this.storage.set({
      ...entity,
      userAttributesUpdated: true,
    })
  }

  getUserAttributesUpdated(): boolean {
    return this.getInternal(this.userId).userAttributesUpdated
  }

  clearUserAttributesUpdated(): void {
    const entity = this.getInternal(this.userId)

    this.storage.set({
      ...entity,
      userAttributesUpdated: false,
    })
  }

  clear(): void {
    this.storage.clear()
  }

  private getInternal(userId: string): EvaluationEntity {
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

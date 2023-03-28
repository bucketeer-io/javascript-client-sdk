import { Evaluation } from '../model/Evaluation'
import { BKTStorage } from '../storage'

export interface EvaluationEntity {
  userId: string
  currentEvaluationsId: string | null
  evaluations: Record<string /* featureId */, Evaluation>
}

export interface EvaluationStorage {
  getByFeatureId(featureId: string): Evaluation | null
  deleteAllAndInsert(evaluationsId: string, evaluations: Evaluation[]): void
  getCurrentEvaluationsId(): string | null
  clearCurrentEvaluationsId(): void
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

  deleteAllAndInsert(evaluationsId: string, evaluations: Evaluation[]): void {
    const entity: EvaluationEntity = {
      userId: this.userId,
      currentEvaluationsId: evaluationsId,
      evaluations: evaluations.reduce<EvaluationEntity['evaluations']>(
        (acc, cur) => {
          return { ...acc, [cur.featureId]: cur }
        },
        {},
      ),
    }

    this.storage.set(entity)
  }

  getCurrentEvaluationsId(): string | null {
    return this.getInternal(this.userId).currentEvaluationsId
  }

  clearCurrentEvaluationsId(): void {
    const entity = this.getInternal(this.userId)
    this.storage.set({
      ...entity,
      currentEvaluationsId: null,
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
      }
    }
    return entity
  }
}

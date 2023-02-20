import { expect, suite, test, beforeEach, afterEach } from 'vitest'
import { EvaluationEntity, EvaluationStorage, EvaluationStorageImpl } from '../../../src/internal/evaluation/EvaluationStorage'
import { BKTStorage, DefaultStorage } from '../../../src/internal/storege'
import { evaluation1, evaluation2, evaluation3 } from '../../mocks/evaluations'

suite('internal/evaluation/EvaluationStorage', () => {

  let storage: BKTStorage<EvaluationEntity>
  let evaluationStorage: EvaluationStorage

  beforeEach(() => {
    storage = new DefaultStorage('bkt_evaluation')
    evaluationStorage = new EvaluationStorageImpl('user_id_1', storage)
  })

  afterEach(() => {
    storage.clear()
  })

  suite('getByFeatureId', () => {
    test('return feature if saved data is present', () => {
      storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        }
      })

      const result = evaluationStorage.getByFeatureId(evaluation1.featureId)

      expect(result).toStrictEqual(evaluation1)
    })

    test('return null if saved data is not present', () => {
      storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        }
      })

      const result = evaluationStorage.getByFeatureId('feature_id_3')

      expect(result).toBeNull()
    })
  })

  test('deleteAllAndInsert', () => {
    storage.set({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluations_id_1',
      evaluations: {
        [evaluation1.featureId]: evaluation1,
        [evaluation2.featureId]: evaluation2,
      }
    })

    evaluationStorage.deleteAllAndInsert('evaluatIons_id_2', [evaluation3])

    expect(storage.get()).toStrictEqual({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluatIons_id_2',
      evaluations: {
        [evaluation3.featureId]: evaluation3,
      }
    })
  })

  suite('getCurrentEvaluationsId', () => {
    test('return currentEvaluationsId if saved data is present', () => {
      storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        }
      })

      const result = evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBe('evaluations_id_1')
    })

    test('return null if saved data is not present', () => {
      const result = evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBeNull()
    })

    test('return null if currentEvaluationsId is not present', () => {
      storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: null,
        evaluations: {}
      })

      const result = evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBeNull()
    })

    test('return null if saved data is for different user', () => {
      storage.set({
        userId: 'user_id_2',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {}
      })

      const result = evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBeNull()
    })
  })
})

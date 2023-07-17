import { expect, suite, test, beforeEach, afterEach } from 'vitest'
import {
  EvaluationEntity,
  EvaluationStorage,
  EvaluationStorageImpl,
} from '../../../src/internal/evaluation/EvaluationStorage'
import { BKTStorage, createBKTStorage } from '../../../src/BKTStorage'
import { evaluation1, evaluation2, evaluation3 } from '../../mocks/evaluations'
import { FakeClock } from '../../utils'

suite('internal/evaluation/EvaluationStorage', () => {
  let storage: BKTStorage<EvaluationEntity>
  let evaluationStorage: EvaluationStorage
  let clock: FakeClock

  beforeEach(() => {
    storage = createBKTStorage('bkt_evaluation')
    evaluationStorage = new EvaluationStorageImpl('user_id_1', storage)
    clock = new FakeClock()
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
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: 1234567890,
        userAttributesUpdated: true,
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
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: 1234567890,
        userAttributesUpdated: true,
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
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: 1234567890,
      userAttributesUpdated: true,
    })

    evaluationStorage.deleteAllAndInsert(
      'evaluatIons_id_2',
      [evaluation3],
      clock.currentTimeMillis(),
    )

    expect(storage.get()).toStrictEqual<EvaluationEntity>({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluatIons_id_2',
      evaluations: {
        [evaluation3.featureId]: evaluation3,
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: clock.currentTimeMillisCalls[0],
      userAttributesUpdated: true,
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
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: 1234567890,
        userAttributesUpdated: true,
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
        evaluations: {},
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: 1234567890,
        userAttributesUpdated: true,
      })

      const result = evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBeNull()
    })

    test('return null if saved data is for different user', () => {
      storage.set({
        userId: 'user_id_2',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {},
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: 1234567890,
        userAttributesUpdated: true,
      })

      const result = evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBeNull()
    })
  })

  suite('getEvaluatedAt', () => {
    test('null if not saved', () => {
      const result = evaluationStorage.getEvaluatedAt()

      expect(result).toBeNull()
    })
  })

  suite('updateFeatureTag', () => {
    test('clear currentEvaluationId if featureTag is different', () => {
      storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: 1234567890,
        userAttributesUpdated: true,
      })

      const updated = evaluationStorage.updateFeatureTag('feature_tag_2')

      expect(updated).toBeTruthy()

      const result = storage.get()

      expect(result?.currentEvaluationsId).toBeNull()
      expect(result?.currentFeatureTag).toBe('feature_tag_2')
    })

    test('do not clear currentEvaluationId if featureTag is same', () => {
      storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: 1234567890,
        userAttributesUpdated: true,
      })

      const updated = evaluationStorage.updateFeatureTag('feature_tag_1')

      expect(updated).toBeFalsy()

      const result = storage.get()

      expect(result?.currentEvaluationsId).toBe('evaluations_id_1')
      expect(result?.currentFeatureTag).toBe('feature_tag_1')
    })
  })

  test('setUserAttributesUpdated', () => {
    evaluationStorage.setUserAttributesUpdated()

    expect(storage.get()?.userAttributesUpdated).toBeTruthy()
  })

  test('getUserAttributesUpdated', () => {
    storage.set({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluations_id_1',
      evaluations: {
        [evaluation1.featureId]: evaluation1,
        [evaluation2.featureId]: evaluation2,
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: 1234567890,
      userAttributesUpdated: true,
    })

    expect(evaluationStorage.getUserAttributesUpdated()).toBeTruthy()
  })

  test('clearUserAttributesUpdated', () => {
    storage.set({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluations_id_1',
      evaluations: {
        [evaluation1.featureId]: evaluation1,
        [evaluation2.featureId]: evaluation2,
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: 1234567890,
      userAttributesUpdated: true,
    })

    evaluationStorage.clearUserAttributesUpdated()

    expect(storage.get()?.userAttributesUpdated).toBeFalsy()
  })
})

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

  beforeEach( async () => {
    storage = createBKTStorage('bkt_evaluation')
    evaluationStorage = new EvaluationStorageImpl('user_id_1', storage)
    clock = new FakeClock()
  })

  afterEach(() => {
    storage.clear()
  })

  suite('initialize', () => { 
    test('should load existing data for correct user', async () => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })

      await evaluationStorage.initialize()

      expect(await evaluationStorage.getCurrentEvaluationsId()).toBe('evaluations_id_1')
      expect(evaluationStorage.getByFeatureId(evaluation1.featureId)).toStrictEqual(evaluation1)
      expect(await evaluationStorage.getUserAttributesUpdated()).toBe(true)
    })

    test('should initialize with default data when storage is empty', async () => {
      await evaluationStorage.initialize()

      expect(await evaluationStorage.getCurrentEvaluationsId()).toBeNull()
      expect(await evaluationStorage.getEvaluatedAt()).toBeNull()
      expect(await evaluationStorage.getUserAttributesUpdated()).toBe(false)
      expect(evaluationStorage.getByFeatureId('any_feature')).toBeNull()
    })

    test('should initialize with default data when userId is different', async () => {
      await storage.set({
        userId: 'different_user_id',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })

      await evaluationStorage.initialize()

      expect(await evaluationStorage.getCurrentEvaluationsId()).toBeNull()
      expect(await evaluationStorage.getEvaluatedAt()).toBeNull()
      expect(await evaluationStorage.getUserAttributesUpdated()).toBe(false)
      expect(evaluationStorage.getByFeatureId(evaluation1.featureId)).toBeNull()
    })

    test('should throw error if called multiple times without clear', async () => {
      await evaluationStorage.initialize()
      
      // Second call should throw an error
      await expect(evaluationStorage.initialize()).rejects.toThrow(
        'Evaluation storage is already initialized. Call clear() to reset.'
      )
    })

    test('should allow re-initialization after clear', async () => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })

      await evaluationStorage.initialize()
      expect(await evaluationStorage.getCurrentEvaluationsId()).toBe('evaluations_id_1')

      // Clear and set new data
      await evaluationStorage.clear()
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_2',
        evaluations: {
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_2',
        evaluatedAt: '9876543210',
        userAttributesUpdated: false,
      })

      // Should be able to initialize again after clear
      await evaluationStorage.initialize()
      expect(await evaluationStorage.getCurrentEvaluationsId()).toBe('evaluations_id_2')
      expect(evaluationStorage.getByFeatureId(evaluation2.featureId)).toStrictEqual(evaluation2)
      expect(evaluationStorage.getByFeatureId(evaluation1.featureId)).toBeNull()
    })

    test('should throw error when trying to access cache before initialization', async () => {
      await expect(evaluationStorage.getCurrentEvaluationsId()).rejects.toThrow(
        'Cache Evaluation entity is not loaded. Call initialize() first.'
      )
      expect(() => evaluationStorage.getByFeatureId('any_feature')).toThrow(
        'Cache Evaluation entity is not loaded. Call initialize() first.'
      )
      await expect(evaluationStorage.getUserAttributesUpdated()).rejects.toThrow(
        'Cache Evaluation entity is not loaded. Call initialize() first.'
      )
    })
  })


  suite('getByFeatureId', () => {
    test('return feature if saved data is present', async () => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })
      await evaluationStorage.initialize()
      const result = evaluationStorage.getByFeatureId(evaluation1.featureId)

      expect(result).toStrictEqual(evaluation1)
    })

    test('return null if saved data is not present', async () => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })
      await evaluationStorage.initialize()
      const result = evaluationStorage.getByFeatureId('feature_id_3')

      expect(result).toBeNull()
    })
  })

  test('deleteAllAndInsert', async () => {
    await storage.set({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluations_id_1',
      evaluations: {
        [evaluation1.featureId]: evaluation1,
        [evaluation2.featureId]: evaluation2,
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: '1234567890',
      userAttributesUpdated: true,
    })

    await evaluationStorage.initialize()

    await evaluationStorage.deleteAllAndInsert(
      'evaluatIons_id_2',
      [evaluation3],
      clock.currentTimeMillis().toString(),
    )

    expect(await storage.get()).toStrictEqual<EvaluationEntity>({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluatIons_id_2',
      evaluations: {
        [evaluation3.featureId]: evaluation3,
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: clock.currentTimeMillisCalls[0].toString(),
      userAttributesUpdated: true,
    })
  })

  suite('getCurrentEvaluationsId', () => {
    test('return currentEvaluationsId if saved data is present', async () => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })

      await evaluationStorage.initialize()

      const result = await evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBe('evaluations_id_1')
    })

    test('return null if saved data is not present', async () => {
      await evaluationStorage.initialize()
      const result = await evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBeNull()
    })

    test('return null if currentEvaluationsId is not present', async () => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: null,
        evaluations: {},
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })
      await evaluationStorage.initialize()
      const result = await evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBeNull()
    })

    test('return null if saved data is for different user', async () => {
      await storage.set({
        userId: 'user_id_2',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {},
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })
      await evaluationStorage.initialize()
      const result = await evaluationStorage.getCurrentEvaluationsId()

      expect(result).toBeNull()
    })
  })

  suite('getEvaluatedAt', () => {
    test('null if not saved', async () => {
      await evaluationStorage.initialize()
      const result = await evaluationStorage.getEvaluatedAt()

      expect(result).toBeNull()
    })
  })

  suite('updateFeatureTag', () => {
    test('clear currentEvaluationId if featureTag is different', async () => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })
      await evaluationStorage.initialize()
      const updated = await evaluationStorage.updateFeatureTag('feature_tag_2')

      expect(updated).toBeTruthy()

      const result = await storage.get()

      expect(result?.currentEvaluationsId).toBeNull()
      expect(result?.currentFeatureTag).toBe('feature_tag_2')
    })

    test('do not clear currentEvaluationId if featureTag is same', async () => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: true,
      })
      await evaluationStorage.initialize()
      const updated = await evaluationStorage.updateFeatureTag('feature_tag_1')

      expect(updated).toBeFalsy()

      const result = await storage.get()

      expect(result?.currentEvaluationsId).toBe('evaluations_id_1')
      expect(result?.currentFeatureTag).toBe('feature_tag_1')
    })
  })

  test('setUserAttributesUpdated', async () => {
    await evaluationStorage.initialize()
    await evaluationStorage.setUserAttributesUpdated()
    expect((await storage.get())?.userAttributesUpdated).toBeTruthy()
  })

  test('getUserAttributesUpdated', async () => {
    await storage.set({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluations_id_1',
      evaluations: {
        [evaluation1.featureId]: evaluation1,
        [evaluation2.featureId]: evaluation2,
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: '1234567890',
      userAttributesUpdated: true,
    })
    await evaluationStorage.initialize()
    expect(await evaluationStorage.getUserAttributesUpdated()).toBeTruthy()
  })

  test('setUserAttributesUpdated unawait, but getUserAttributesUpdated should get the updated data', async () => {
    // This test ensures that the setUserAttributesUpdated method can be called without awaiting,
    // and the getUserAttributesUpdated method will still return the updated value.
    // This proves that our mutex is working correctly and the data is being updated asynchronously.
    await storage.set({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluations_id_1',
      evaluations: {
        [evaluation1.featureId]: evaluation1,
        [evaluation2.featureId]: evaluation2,
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: '1234567890',
      userAttributesUpdated: false,
    })
    await evaluationStorage.initialize()
    // assert that userAttributesUpdated is false before setting it
    expect(await evaluationStorage.getUserAttributesUpdated()).toBeFalsy()
    // Important: should unawaited  
    evaluationStorage.setUserAttributesUpdated() 

    expect(await evaluationStorage.getUserAttributesUpdated()).toBeTruthy()
  })

  test('clearUserAttributesUpdated', async () => {
    await storage.set({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluations_id_1',
      evaluations: {
        [evaluation1.featureId]: evaluation1,
        [evaluation2.featureId]: evaluation2,
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: '1234567890',
      userAttributesUpdated: true,
    })
    await evaluationStorage.initialize()
    await evaluationStorage.clearUserAttributesUpdated()

    expect((await storage.get())?.userAttributesUpdated).toBeFalsy()
  })
})

import { expect, suite, test, beforeEach, afterEach, vi } from 'vitest'
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
      expect(evaluationStorage.getUserAttributesState().userAttributesUpdated).toBe(true)
    })

    test('should initialize with default data when storage is empty', async () => {
      await evaluationStorage.initialize()

      expect(await evaluationStorage.getCurrentEvaluationsId()).toBeNull()
      expect(await evaluationStorage.getEvaluatedAt()).toBeNull()
      expect(evaluationStorage.getUserAttributesState().userAttributesUpdated).toBe(false)
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
      expect(evaluationStorage.getUserAttributesState().userAttributesUpdated).toBe(false)
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
      expect(() => evaluationStorage.getUserAttributesState()).toThrow(
        'Cache Evaluation entity is not loaded. Call initialize() first.'
      )
      expect(() => evaluationStorage.getCurrentEvaluationsCondition()).toThrow(
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

  suite('staleness guard (concurrent writers must not rewind state)', () => {
    const seed = async (evaluatedAt: string) => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
        },
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt,
        userAttributesUpdated: false,
      })
      await evaluationStorage.initialize()
    }

    suite('update', () => {
      test('strictly-older evaluatedAt is a no-op: returns false, storage unchanged', async () => {
        await seed('1700000000')

        const result = await evaluationStorage.update(
          'evaluations_id_2',
          [evaluation2],
          [],
          '1699999999',
        )

        expect(result).toBe(false)
        expect(await storage.get()).toStrictEqual<EvaluationEntity>({
          userId: 'user_id_1',
          currentEvaluationsId: 'evaluations_id_1',
          evaluations: {
            [evaluation1.featureId]: evaluation1,
          },
          currentFeatureTag: 'feature_tag_1',
          evaluatedAt: '1700000000',
          userAttributesUpdated: false,
        })
      })

      test('equal evaluatedAt still applies (same-tick patches must not be dropped)', async () => {
        await seed('1700000000')

        const result = await evaluationStorage.update(
          'evaluations_id_2',
          [evaluation2],
          [],
          '1700000000',
        )

        expect(result).toBe(true)
        expect((await storage.get())?.currentEvaluationsId).toBe(
          'evaluations_id_2',
        )
      })

      test('newer evaluatedAt applies normally', async () => {
        await seed('1700000000')

        const result = await evaluationStorage.update(
          'evaluations_id_2',
          [evaluation2],
          [],
          '1700000001',
        )

        expect(result).toBe(true)
        expect((await storage.get())?.evaluatedAt).toBe('1700000001')
      })

      test('a fresh install (evaluatedAt null) is never treated as stale', async () => {
        await evaluationStorage.initialize()

        const result = await evaluationStorage.update(
          'evaluations_id_1',
          [evaluation1],
          [],
          '0',
        )

        expect(result).toBe(true)
        expect((await storage.get())?.evaluatedAt).toBe('0')
      })
    })

    suite('deleteAllAndInsert', () => {
      test('strictly-older evaluatedAt is a no-op: returns false, storage unchanged', async () => {
        await seed('1700000000')

        const result = await evaluationStorage.deleteAllAndInsert(
          'evaluations_id_2',
          [evaluation2],
          '1699999999',
        )

        expect(result).toBe(false)
        expect(await storage.get()).toStrictEqual<EvaluationEntity>({
          userId: 'user_id_1',
          currentEvaluationsId: 'evaluations_id_1',
          evaluations: {
            [evaluation1.featureId]: evaluation1,
          },
          currentFeatureTag: 'feature_tag_1',
          evaluatedAt: '1700000000',
          userAttributesUpdated: false,
        })
      })

      test('equal evaluatedAt still applies', async () => {
        await seed('1700000000')

        const result = await evaluationStorage.deleteAllAndInsert(
          'evaluations_id_2',
          [evaluation2],
          '1700000000',
        )

        expect(result).toBe(true)
        expect((await storage.get())?.currentEvaluationsId).toBe(
          'evaluations_id_2',
        )
      })

      test('newer evaluatedAt applies normally', async () => {
        await seed('1700000000')

        const result = await evaluationStorage.deleteAllAndInsert(
          'evaluations_id_2',
          [evaluation2],
          '1700000001',
        )

        expect(result).toBe(true)
        expect((await storage.get())?.evaluatedAt).toBe('1700000001')
      })
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

  suite('getCurrentEvaluationsCondition', () => {
    test('throws before initialize() — same contract as the other getters', () => {
      // initializeBKTClientInternal() guarantees initialize() always resolves
      // before any task (including StreamingTask's first connect) can reach
      // this storage — see the ordering comment on
      // BKTClientImpl.initializeCache().
      expect(() => evaluationStorage.getCurrentEvaluationsCondition()).toThrow(
        'Cache Evaluation entity is not loaded. Call initialize() first.',
      )
    })

    test('returns nulls after initialize() when storage is empty', async () => {
      await evaluationStorage.initialize()

      expect(evaluationStorage.getCurrentEvaluationsCondition()).toStrictEqual({
        currentEvaluationsId: null,
        evaluatedAt: null,
      })
    })

    test('returns the stored values after initialize()', async () => {
      await storage.set({
        userId: 'user_id_1',
        currentEvaluationsId: 'evaluations_id_1',
        evaluations: {},
        currentFeatureTag: 'feature_tag_1',
        evaluatedAt: '1234567890',
        userAttributesUpdated: false,
      })
      await evaluationStorage.initialize()

      expect(evaluationStorage.getCurrentEvaluationsCondition()).toStrictEqual({
        currentEvaluationsId: 'evaluations_id_1',
        evaluatedAt: '1234567890',
      })
    })

    test('reflects the latest values after an update', async () => {
      await evaluationStorage.initialize()

      await evaluationStorage.deleteAllAndInsert(
        'evaluations_id_2',
        [evaluation1],
        '9876543210',
      )

      expect(evaluationStorage.getCurrentEvaluationsCondition()).toStrictEqual({
        currentEvaluationsId: 'evaluations_id_2',
        evaluatedAt: '9876543210',
      })
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

  test('getUserAttributesState', async () => {
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
    expect(evaluationStorage.getUserAttributesState().userAttributesUpdated).toBeTruthy()
  })

  test('setUserAttributesUpdated must be awaited for getUserAttributesState to observe it (synchronous cache read, same contract as getCurrentEvaluationsCondition — unlike the old mutex-queued getUserAttributesUpdated getter, this no longer tolerates a caller forgetting to await)', async () => {
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
    expect(evaluationStorage.getUserAttributesState().userAttributesUpdated).toBeFalsy()
    await evaluationStorage.setUserAttributesUpdated()

    expect(evaluationStorage.getUserAttributesState().userAttributesUpdated).toBeTruthy()
  })

  test('clearUserAttributesUpdated with the current state clears the flag', async () => {
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
    const state = evaluationStorage.getUserAttributesState()
    await evaluationStorage.clearUserAttributesUpdated(state)

    expect((await storage.get())?.userAttributesUpdated).toBeFalsy()
  })

  test('clearUserAttributesUpdated skips the storage write when the flag is already false (matching sequence, nothing to clear)', async () => {
    // The common case: every stream (re)connect and every successful poll
    // clears the flag, but it is usually already false — rewriting the whole
    // evaluations map to storage to set false → false is pure waste.
    await storage.set({
      userId: 'user_id_1',
      currentEvaluationsId: 'evaluations_id_1',
      evaluations: {
        [evaluation1.featureId]: evaluation1,
      },
      currentFeatureTag: 'feature_tag_1',
      evaluatedAt: '1234567890',
      userAttributesUpdated: false,
    })
    await evaluationStorage.initialize()
    const setSpy = vi.spyOn(storage, 'set')

    await evaluationStorage.clearUserAttributesUpdated(
      evaluationStorage.getUserAttributesState(),
    )

    expect(setSpy).not.toHaveBeenCalled()
  })

  test('getUserAttributesState().updateSequence increments on every setUserAttributesUpdated call', async () => {
    await evaluationStorage.initialize()
    const initial = evaluationStorage.getUserAttributesState().updateSequence

    await evaluationStorage.setUserAttributesUpdated()
    expect(evaluationStorage.getUserAttributesState().updateSequence).toBe(initial + 1)

    await evaluationStorage.setUserAttributesUpdated()
    expect(evaluationStorage.getUserAttributesState().updateSequence).toBe(initial + 2)
  })

  test('clearUserAttributesUpdated no-ops when a newer setUserAttributesUpdated happened after the state was captured (regression: an in-flight stale fetch must not wipe a newer flag)', async () => {
    await evaluationStorage.initialize()
    await evaluationStorage.setUserAttributesUpdated()
    // Simulates a fallback fetch that captured state before issuing its
    // request, then a concurrent updateUserAttributes() call raced ahead of it.
    const staleState = evaluationStorage.getUserAttributesState()
    await evaluationStorage.setUserAttributesUpdated()

    await evaluationStorage.clearUserAttributesUpdated(staleState)

    expect(evaluationStorage.getUserAttributesState().userAttributesUpdated).toBe(true)
  })

  test('clearUserAttributesUpdated is a no-op (still requires initialize) before initialize()', async () => {
    await expect(
      evaluationStorage.clearUserAttributesUpdated({ userAttributesUpdated: false, updateSequence: 0 }),
    ).rejects.toThrow(
      'Cache Evaluation entity is not loaded. Call initialize() first.'
    )
  })
})

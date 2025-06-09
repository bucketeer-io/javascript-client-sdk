import { HttpResponse, http } from 'msw'
import { SetupServer } from 'msw/node'
import {
  expect,
  suite,
  test,
  beforeEach,
  afterEach,
  vi,
  beforeAll,
  afterAll,
} from 'vitest'

import assert from 'assert'
import { BKTConfig, defineBKTConfig } from '../../../src/BKTConfig'
import { DefaultComponent } from '../../../src/internal/di/Component'
import { DataModule } from '../../../src/internal/di/DataModule'
import { InteractorModule } from '../../../src/internal/di/InteractorModule'
import { user1 } from '../../mocks/users'
import { EvaluationInteractor } from '../../../src/internal/evaluation/EvaluationInteractor'
import { GetEvaluationsRequest } from '../../../src/internal/model/request/GetEvaluationsRequest'
import { GetEvaluationsResponse } from '../../../src/internal/model/response/GetEvaluationsResponse'
import {
  evaluation1,
  evaluation2,
  evaluation3,
  user1Evaluations,
} from '../../mocks/evaluations'
import {
  EvaluationEntity,
  EvaluationStorageImpl,
} from '../../../src/internal/evaluation/EvaluationStorage'
import { FakeClock, setupServerAndListen } from '../../utils'
import { NodePlatformModule } from '../../../src/internal/di/PlatformModule.node'
import { requiredInternalConfig } from '../../../src/internal/InternalConfig'

suite('internal/evaluation/EvaluationInteractor', () => {
  let server: SetupServer
  let config: BKTConfig
  let component: DefaultComponent
  let interactor: EvaluationInteractor
  let evaluationStorage: EvaluationStorageImpl
  let clock: FakeClock

  beforeAll(() => {
    server = setupServerAndListen()
  })

  beforeEach(() => {
    config = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value',
      appVersion: '1.2.3',
      fetch,
    })
    component = new DefaultComponent(
      new NodePlatformModule(),
      new DataModule(user1, requiredInternalConfig(config)),
      new InteractorModule(),
    )

    interactor = component.evaluationInteractor()
    evaluationStorage =
      component.dataModule.evaluationStorage() as EvaluationStorageImpl

    clock = new FakeClock()
  })

  afterEach(() => {
    server.resetHandlers()
    evaluationStorage.clear()
  })

  afterAll(() => {
    server.close()
  })

  suite('fetch', () => {
    test('initial load', async () => {
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async () => {
          return HttpResponse.json({
            evaluations: {
              ...user1Evaluations,
              createdAt: clock.currentTimeMillis().toString(),
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
      )

      expect(
        component.dataModule.evaluationStorage().getCurrentEvaluationsId(),
      ).toBeNull()

      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      const result = await interactor.fetch(user1)

      assert(result.type === 'success')

      const stored = evaluationStorage.storage.get()

      expect(stored).toStrictEqual<EvaluationEntity>({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: clock.currentTimeMillisCalls[0].toString(),
        userAttributesUpdated: false,
      })

      expect(mockListener).toBeCalledTimes(1)
    })

    test('update', async () => {
      const newEvaluation = {
        ...evaluation1,
        variationValue: 'new_variation_value',
      }
      server.use(
        // initial request
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async () => {
          return HttpResponse.json({
            evaluations: {
              ...user1Evaluations,
              createdAt: clock.currentTimeMillis().toString(),
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }, { once: true }),
        // second request
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async () => {
          return HttpResponse.json({
            evaluations: {
              ...user1Evaluations,
              evaluations: [newEvaluation],
              createdAt: clock.currentTimeMillis().toString(),
            },
            userEvaluationsId: 'user_evaluation_id_value_updated',
          })
        }, { once: true }),
      )

      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      // initial request
      const result1 = await interactor.fetch(user1)

      assert(result1.type === 'success')
      expect(evaluationStorage.getCurrentEvaluationsId()).toBe(
        'user_evaluation_id_value',
      )

      // second request
      const result2 = await interactor.fetch(user1)

      assert(result2.type === 'success')

      const stored = evaluationStorage.storage.get()
      expect(stored).toStrictEqual<EvaluationEntity>({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value_updated',
        evaluations: {
          [user1Evaluations.evaluations[0].featureId]:
            user1Evaluations.evaluations[0],
          [user1Evaluations.evaluations[1].featureId]:
            user1Evaluations.evaluations[1],
          [newEvaluation.featureId]: newEvaluation,
        },
        evaluatedAt: clock.currentTimeMillisCalls[1].toString(),
        currentFeatureTag: 'feature_tag_value',
        userAttributesUpdated: false,
      })

      expect(mockListener).toBeCalledTimes(2)
    })

    test('update with no change', async () => {
      const requestInterceptor = vi.fn()

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async ({request}) => {
          requestInterceptor(request)
          return HttpResponse.json({
            evaluations: {
              ...user1Evaluations,
              createdAt: clock.currentTimeMillis().toString(),
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async ({request}) => {
          requestInterceptor(request)
          return HttpResponse.json({
            evaluations: {
              id: '17388826713971171773',
              evaluations: [],
              archivedFeatureIds: [],
              createdAt: clock.currentTimeMillis().toString(),
              forceUpdate: false,
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
      )

      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      const result1 = await interactor.fetch(user1)
      const result2 = await interactor.fetch(user1)

      assert(result1.type === 'success')
      assert(result2.type === 'success')

      const stored = evaluationStorage.storage.get()
      expect(stored).toStrictEqual<EvaluationEntity>({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        userAttributesUpdated: false,
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: clock.currentTimeMillisCalls[1].toString(),
      })

      expect(mockListener).toBeCalledTimes(2)
    })
  })

  suite('getLatest', () => {
    test('has cache', () => {
      evaluationStorage.storage.set({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: '1234567890',
        userAttributesUpdated: false,
      })

      const result = interactor.getLatest(evaluation1.featureId)

      expect(result).toStrictEqual(evaluation1)
    })

    test('no cache', () => {
      evaluationStorage.storage.set({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: '1234567890',
        userAttributesUpdated: false,
      })

      const result = interactor.getLatest(evaluation3.featureId)

      expect(result).toBeNull()
    })
  })

  test('addUpdateListener', () => {
    const key1 = interactor.addUpdateListener(() => {
      /* empty */
    })
    const key2 = interactor.addUpdateListener(() => {
      /* empty */
    })

    expect(Object.keys(interactor.updateListeners)).toEqual([key1, key2])
  })

  test('removeUpdateListener', () => {
    const key1 = interactor.addUpdateListener(() => {
      /* empty */
    })
    const key2 = interactor.addUpdateListener(() => {
      /* empty */
    })

    expect(Object.keys(interactor.updateListeners)).toEqual([key1, key2])

    interactor.removeUpdateListener(key1)

    expect(Object.keys(interactor.updateListeners)).toEqual([key2])
  })

  test('clearUpdateListeners', () => {
    interactor.addUpdateListener(() => {
      /* empty */
    })
    interactor.addUpdateListener(() => {
      /* empty */
    })

    expect(Object.keys(interactor.updateListeners)).toHaveLength(2)

    interactor.clearUpdateListeners()

    expect(Object.keys(interactor.updateListeners)).toHaveLength(0)
  })

  suite('update', () => {
    const evaluation1_updated = {
      ...evaluation1,
      variationValue: `${evaluation1.variationValue} updated`,
    }
    const evaluation2_updated = {
      ...evaluation2,
      variationValue: `${evaluation2.variationValue} updated`,
    }

    test('forceUpdate=true', async () => {
      evaluationStorage.storage.set({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: clock.currentTimeMillis().toString(),
        userAttributesUpdated: false,
      })

      const mockListener = vi.fn()

      interactor.addUpdateListener(mockListener)

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async () => {
          return HttpResponse.json({
            evaluations: {
              id: '17388826713971171773',
              evaluations: [evaluation1_updated, evaluation2],
              createdAt: clock.currentTimeMillis().toString(),
              forceUpdate: false,
              archivedFeatureIds: [],
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
      )

      await interactor.fetch(user1)

      // all values are updated
      expect(evaluationStorage.storage.get()).toStrictEqual<EvaluationEntity>({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1_updated.featureId]: evaluation1_updated,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: clock.currentTimeMillisCalls[1].toString(),
        userAttributesUpdated: false,
      })

      expect(mockListener).toBeCalledTimes(1)
    })

    test('upsert evaluations', async () => {
      evaluationStorage.storage.set({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: clock.currentTimeMillis().toString(),
        userAttributesUpdated: false,
      })

      const mockListener = vi.fn()

      interactor.addUpdateListener(mockListener)

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async () => {
          return HttpResponse.json({
            evaluations: {
              id: '17388826713971171773',
              evaluations: [evaluation2_updated],
              createdAt: clock.currentTimeMillis().toString(),
              forceUpdate: false,
              archivedFeatureIds: [],
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
      )

      await interactor.fetch(user1)

      // evaluation1 still exists
      expect(evaluationStorage.storage.get()).toStrictEqual<EvaluationEntity>({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2_updated.featureId]: evaluation2_updated,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: clock.currentTimeMillisCalls[1].toString(),
        userAttributesUpdated: false,
      })

      expect(mockListener).toBeCalledTimes(1)
    })

    test('upsert - with archivedFeatureIds', async () => {
      evaluationStorage.storage.set({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: clock.currentTimeMillis().toString(),
        userAttributesUpdated: false,
      })

      const mockListener = vi.fn()

      interactor.addUpdateListener(mockListener)

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async () => {
          return HttpResponse.json({
            evaluations: {
              id: '17388826713971171773',
              evaluations: [evaluation1_updated],
              createdAt: clock.currentTimeMillis().toString(),
              forceUpdate: false,
              archivedFeatureIds: [evaluation2.featureId],
            },
            userEvaluationsId: 'user_evaluation_id_value',
          })
        }),
      )

      await interactor.fetch(user1)

      // archived evaluation2 should be removed
      expect(evaluationStorage.storage.get()).toStrictEqual<EvaluationEntity>({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1_updated.featureId]: evaluation1_updated,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: clock.currentTimeMillisCalls[1].toString(),
        userAttributesUpdated: false,
      })

      expect(mockListener).toBeCalledTimes(1)
    })
  })
})

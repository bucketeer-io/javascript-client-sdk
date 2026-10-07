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

  beforeEach( async () => {
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

  afterEach( async () => {
    server.resetHandlers()
    await evaluationStorage.clear()
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

      await interactor.initialize()
      expect(
        await component.dataModule.evaluationStorage().getCurrentEvaluationsId(),
      ).toBeNull()

      const mockListener = vi.fn()

     
      interactor.addUpdateListener(mockListener)

      const result = await interactor.fetch(user1)

      assert(result.type === 'success')

      const stored = await evaluationStorage.storage.get()

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

      await interactor.initialize()
      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      // initial request
      const result1 = await interactor.fetch(user1)

      assert(result1.type === 'success')
      expect(await evaluationStorage.getCurrentEvaluationsId()).toBe(
        'user_evaluation_id_value',
      )

      // second request
      const result2 = await interactor.fetch(user1)

      assert(result2.type === 'success')

      const stored = await evaluationStorage.storage.get()
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

      await interactor.initialize()
      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      const result1 = await interactor.fetch(user1)
      const result2 = await interactor.fetch(user1)

      assert(result1.type === 'success')
      assert(result2.type === 'success')

      const stored = await evaluationStorage.storage.get()
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

    test('a listener fired during fetch() observes userAttributesUpdated already cleared (ordering regression: clear must run before notify)', async () => {
      // main's ordering: clear the flag, THEN apply/notify. If a listener
      // (e.g. a refresh-on-change pattern) synchronously triggers a nested
      // read of the flag, it must see it already cleared — otherwise the
      // nested caller re-sends userAttributesUpdated:true and gets a
      // redundant forceUpdate snapshot back.
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

      await interactor.initialize()
      await interactor.setUserAttributesUpdated()

      let capturedFlag: boolean | undefined
      interactor.addUpdateListener(() => {
        // getUserAttributesState() is a synchronous cache read: capturing it
        // here, from inside the listener, reflects the flag's state as of
        // this exact point in the clear/notify ordering, not just "eventually".
        capturedFlag = evaluationStorage.getUserAttributesState().userAttributesUpdated
      })

      const result = await interactor.fetch(user1)
      assert(result.type === 'success')

      expect(capturedFlag).toBe(false)
    })

    test('an updateUserAttributes() landing after fetch() starts must not have its flag cleared by that fetch', async () => {
      // fetch()'s caller snapshots the user synchronously at the call site, so
      // any attribute change that lands after fetch() begins was NOT carried
      // by this request. The attributes-state snapshot must therefore be
      // captured before fetch()'s first await — otherwise a set landing
      // inside that window gets the request's sequence stamp and the
      // success-path clear wipes a flag whose attributes were never sent.
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

      await interactor.initialize()

      // Hold fetch()'s first awaited storage read open so a
      // setUserAttributesUpdated() call can land inside the pre-request window.
      let releaseRead: () => void = () => {}
      const realGetCurrentEvaluationsId =
        evaluationStorage.getCurrentEvaluationsId.bind(evaluationStorage)
      vi.spyOn(evaluationStorage, 'getCurrentEvaluationsId').mockImplementation(
        async () => {
          await new Promise<void>((resolve) => {
            releaseRead = resolve
          })
          return realGetCurrentEvaluationsId()
        },
      )

      const fetchPromise = interactor.fetch(user1)
      // fetch() is parked inside its first await; this update lands after the
      // request's user snapshot, so the request does not carry it.
      await interactor.setUserAttributesUpdated()
      releaseRead()

      const result = await fetchPromise
      assert(result.type === 'success')

      // The flag belongs to attributes this request never sent — it must
      // survive for the next request to pick up.
      expect(
        evaluationStorage.getUserAttributesState().userAttributesUpdated,
      ).toBe(true)
    })

    test('a failed storage write keeps userAttributesUpdated set, so the next poll retries the attribute-driven refresh', async () => {
      // The server's response to a userAttributesUpdated:true request carries
      // the re-evaluation the flag asked for. If persisting it fails (e.g.
      // browser storage quota), the flag must NOT have been cleared yet —
      // otherwise the next poll sends userAttributesUpdated:false and the
      // re-evaluation is silently lost. Clear must come after the write.
      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async () => {
          return HttpResponse.json({
            evaluations: {
              id: '17388826713971171773',
              evaluations: [evaluation2],
              createdAt: clock.currentTimeMillis().toString(),
              forceUpdate: true,
              archivedFeatureIds: [],
            },
            userEvaluationsId: 'new_user_evaluation_id',
          })
        }),
      )

      await interactor.initialize()
      await interactor.setUserAttributesUpdated()

      vi.spyOn(evaluationStorage, 'deleteAllAndInsert').mockRejectedValue(
        new Error('QuotaExceededError'),
      )

      await expect(interactor.fetch(user1)).rejects.toThrow(
        'QuotaExceededError',
      )

      expect(
        evaluationStorage.getUserAttributesState().userAttributesUpdated,
      ).toBe(true)
    })

    suite('a reply skipped as stale keeps userAttributesUpdated set', () => {
      // The reply to a userAttributesUpdated:true request carries the
      // re-evaluation for the new attributes. If storage skips that reply
      // because a newer one is already stored, the re-evaluation was never
      // saved, so the flag must survive for the next poll to ask again.
      const storedEvaluationsId = 'stored_evaluations_id'
      const storedEvaluatedAt = '1700000100'
      const olderCreatedAt = '1700000000'

      const reply = (
        userEvaluationsId: string,
        createdAt: string,
        forceUpdate: boolean,
      ): GetEvaluationsResponse => ({
        evaluations: {
          id: '17388826713971171773',
          evaluations: [evaluation2],
          createdAt,
          forceUpdate,
          archivedFeatureIds: [],
        },
        userEvaluationsId,
      })

      const seedStorage = async (evaluatedAt: string) => {
        await evaluationStorage.storage.set({
          userId: user1.id,
          currentEvaluationsId: storedEvaluationsId,
          evaluations: {
            [evaluation1.featureId]: evaluation1,
          },
          currentFeatureTag: 'feature_tag_value',
          evaluatedAt,
          userAttributesUpdated: false,
        })
        await interactor.initialize()
      }

      test.each([
        ['full snapshot (forceUpdate: true)', true],
        ['diff (forceUpdate: false)', false],
      ])('a stale %s reply does not clear the flag', async (_, forceUpdate) => {
        server.use(
          http.post<
            Record<string, never>,
            GetEvaluationsRequest,
            GetEvaluationsResponse
          >(`${config.apiEndpoint}/get_evaluations`, async () => {
            return HttpResponse.json(
              reply('older_evaluations_id', olderCreatedAt, forceUpdate),
            )
          }),
        )
        await seedStorage(storedEvaluatedAt)
        await interactor.setUserAttributesUpdated()

        const result = await interactor.fetch(user1)
        assert(result.type === 'success')

        // The reply was really skipped: nothing from it was stored.
        const stored = await evaluationStorage.storage.get()
        expect(stored?.currentEvaluationsId).toBe(storedEvaluationsId)
        expect(stored?.evaluatedAt).toBe(storedEvaluatedAt)
        expect(
          evaluationStorage.getUserAttributesState().userAttributesUpdated,
        ).toBe(true)
      })

      test('the next poll still sends userAttributesUpdated: true', async () => {
        const sentFlags: boolean[] = []
        server.use(
          http.post<
            Record<string, never>,
            GetEvaluationsRequest,
            GetEvaluationsResponse
          >(`${config.apiEndpoint}/get_evaluations`, async ({ request }) => {
            const body = await request.json()
            sentFlags.push(body.userEvaluationCondition.userAttributesUpdated)
            return HttpResponse.json(
              reply('older_evaluations_id', olderCreatedAt, true),
            )
          }),
        )
        await seedStorage(storedEvaluatedAt)
        await interactor.setUserAttributesUpdated()

        await interactor.fetch(user1)
        await interactor.fetch(user1)

        // The first value proves the setup; the second is the real check.
        expect(sentFlags).toEqual([true, true])
      })

      test('overlapping polls: an older reply for the new attributes arriving after a newer reply for the old attributes', async () => {
        // A scheduled poll and a manual fetchEvaluations() do not wait for
        // each other. Poll A starts before updateUserAttributes(), poll B
        // after. The server evaluates B first, so A's reply is newer and
        // B's reply is skipped when it arrives second.
        const sentFlags: boolean[] = []
        const pendingReplies: Array<(response: GetEvaluationsResponse) => void> =
          []
        server.use(
          http.post<
            Record<string, never>,
            GetEvaluationsRequest,
            GetEvaluationsResponse
          >(`${config.apiEndpoint}/get_evaluations`, async ({ request }) => {
            const body = await request.json()
            sentFlags.push(body.userEvaluationCondition.userAttributesUpdated)
            const response = await new Promise<GetEvaluationsResponse>(
              (resolve) => pendingReplies.push(resolve),
            )
            return HttpResponse.json(response)
          }),
        )
        await seedStorage(olderCreatedAt)

        const pollA = interactor.fetch(user1)
        await vi.waitFor(() => expect(pendingReplies).toHaveLength(1))
        await interactor.setUserAttributesUpdated()
        const pollB = interactor.fetch(user1)
        await vi.waitFor(() => expect(pendingReplies).toHaveLength(2))
        expect(sentFlags).toEqual([false, true])

        pendingReplies[0](reply('reply_a_evaluations_id', '1700000205', true))
        await pollA
        pendingReplies[1](reply('reply_b_evaluations_id', '1700000200', true))
        await pollB

        const stored = await evaluationStorage.storage.get()
        expect(stored?.currentEvaluationsId).toBe('reply_a_evaluations_id')
        expect(
          evaluationStorage.getUserAttributesState().userAttributesUpdated,
        ).toBe(true)
      })
    })
  })

  suite('getLatest', () => {
    test('has cache', async () => {
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
      await evaluationStorage.initialize()
      const result = interactor.getLatest(evaluation1.featureId)

      expect(result).toStrictEqual(evaluation1)
    })

    test('no cache', async () => {
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
      await interactor.initialize()
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

      await interactor.initialize()
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
      expect(await evaluationStorage.storage.get()).toStrictEqual<EvaluationEntity>({
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
      await interactor.initialize()  
      await interactor.fetch(user1)

      // evaluation1 still exists
      expect(await evaluationStorage.storage.get()).toStrictEqual<EvaluationEntity>({
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
      await evaluationStorage.storage.set({
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

      await interactor.initialize()
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
      expect(await evaluationStorage.storage.get()).toStrictEqual<EvaluationEntity>({
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

  suite('applyEvaluationsResponse', () => {
    const seedStorage = async (userAttributesUpdated: boolean) => {
      await evaluationStorage.storage.set({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: clock.currentTimeMillis().toString(),
        userAttributesUpdated,
      })
      await interactor.initialize()
    }

    test('forceUpdate=true deletes all and inserts, then notifies listeners', async () => {
      await seedStorage(false)
      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      const createdAt = clock.currentTimeMillis().toString()
      await interactor.applyEvaluationsResponse({
        evaluations: {
          id: '17388826713971171773',
          evaluations: [evaluation2],
          createdAt,
          forceUpdate: true,
          archivedFeatureIds: [],
        },
        userEvaluationsId: 'new_user_evaluation_id',
      })

      // evaluation1 is gone — the response replaced the whole cache
      expect(await evaluationStorage.storage.get()).toStrictEqual<EvaluationEntity>({
        userId: user1.id,
        currentEvaluationsId: 'new_user_evaluation_id',
        evaluations: {
          [evaluation2.featureId]: evaluation2,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: createdAt,
        userAttributesUpdated: false,
      })
      expect(mockListener).toBeCalledTimes(1)
    })

    test('stale forceUpdate (createdAt strictly older than the stored evaluatedAt) is skipped: no notify, no overwrite', async () => {
      await evaluationStorage.storage.set({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: '1700000000',
        userAttributesUpdated: false,
      })
      await interactor.initialize()
      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      await interactor.applyEvaluationsResponse({
        evaluations: {
          id: '17388826713971171773',
          evaluations: [evaluation2],
          createdAt: '1699999999', // strictly older than the stored evaluatedAt
          forceUpdate: true,
          archivedFeatureIds: [],
        },
        userEvaluationsId: 'new_user_evaluation_id',
      })

      expect(mockListener).not.toHaveBeenCalled()
      expect(await evaluationStorage.storage.get()).toStrictEqual<EvaluationEntity>({
        userId: user1.id,
        currentEvaluationsId: 'user_evaluation_id_value',
        evaluations: {
          [evaluation1.featureId]: evaluation1,
        },
        currentFeatureTag: 'feature_tag_value',
        evaluatedAt: '1700000000',
        userAttributesUpdated: false,
      })
    })

    test('upsert notifies listeners only when something changed', async () => {
      await seedStorage(false)
      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      // Same evaluationsId, no evaluations, no archived ids → no change.
      await interactor.applyEvaluationsResponse({
        evaluations: {
          id: '17388826713971171773',
          evaluations: [],
          createdAt: clock.currentTimeMillis().toString(),
          forceUpdate: false,
          archivedFeatureIds: [],
        },
        userEvaluationsId: 'user_evaluation_id_value',
      })
      expect(mockListener).toBeCalledTimes(0)

      // An upserted evaluation is a change → notify.
      await interactor.applyEvaluationsResponse({
        evaluations: {
          id: '17388826713971171773',
          evaluations: [evaluation2],
          createdAt: clock.currentTimeMillis().toString(),
          forceUpdate: false,
          archivedFeatureIds: [],
        },
        userEvaluationsId: 'user_evaluation_id_value',
      })
      expect(mockListener).toBeCalledTimes(1)
    })

    test('shouldNotify=() => false suppresses the listener but the storage write still lands', async () => {
      // Regression for a destroy racing an in-flight apply (StreamingTask
      // passes shouldNotify: () => this.running): the write must not be lost,
      // only the listener callback — which could run app code against a
      // torn-down client — is suppressed.
      await seedStorage(false)
      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      const createdAt = clock.currentTimeMillis().toString()
      await interactor.applyEvaluationsResponse(
        {
          evaluations: {
            id: '17388826713971171773',
            evaluations: [evaluation2],
            createdAt,
            forceUpdate: true,
            archivedFeatureIds: [],
          },
          userEvaluationsId: 'new_user_evaluation_id',
        },
        () => false,
      )

      expect(mockListener).not.toHaveBeenCalled()
      const stored = await evaluationStorage.storage.get()
      expect(stored?.currentEvaluationsId).toBe('new_user_evaluation_id')
    })

    test('shouldNotify=() => true behaves the same as omitting the argument', async () => {
      await seedStorage(false)
      const mockListener = vi.fn()
      interactor.addUpdateListener(mockListener)

      await interactor.applyEvaluationsResponse(
        {
          evaluations: {
            id: '17388826713971171773',
            evaluations: [evaluation2],
            createdAt: clock.currentTimeMillis().toString(),
            forceUpdate: true,
            archivedFeatureIds: [],
          },
          userEvaluationsId: 'new_user_evaluation_id',
        },
        () => true,
      )

      expect(mockListener).toHaveBeenCalledTimes(1)
    })

    test('does NOT clear userAttributesUpdated (streamed data must not clear the flag)', async () => {
      // A streamed message can race a concurrent updateUserAttributes() — it may
      // have been produced before the new attributes existed, so it must never
      // clear the flag. Only fetch(), which sent the attributes, may clear it.
      await seedStorage(true)

      await interactor.applyEvaluationsResponse({
        evaluations: {
          id: '17388826713971171773',
          evaluations: [evaluation2],
          createdAt: clock.currentTimeMillis().toString(),
          forceUpdate: false,
          archivedFeatureIds: [],
        },
        userEvaluationsId: 'new_user_evaluation_id',
      })

      const stored = await evaluationStorage.storage.get()
      expect(stored?.userAttributesUpdated).toBe(true)
    })

    test('fetch() success applies the response AND clears userAttributesUpdated', async () => {
      await seedStorage(true)

      server.use(
        http.post<
          Record<string, never>,
          GetEvaluationsRequest,
          GetEvaluationsResponse
        >(`${config.apiEndpoint}/get_evaluations`, async () => {
          return HttpResponse.json({
            evaluations: {
              id: '17388826713971171773',
              evaluations: [evaluation2],
              createdAt: clock.currentTimeMillis().toString(),
              forceUpdate: false,
              archivedFeatureIds: [],
            },
            userEvaluationsId: 'new_user_evaluation_id',
          })
        }),
      )

      const result = await interactor.fetch(user1)
      assert(result.type === 'success')

      const stored = await evaluationStorage.storage.get()
      expect(stored?.evaluations[evaluation2.featureId]).toStrictEqual(evaluation2)
      expect(stored?.userAttributesUpdated).toBe(false)
    })
  })
})

import { suite, test, expect, beforeEach, afterEach, assert } from 'vitest'
import {
  destroyBKTClient,
  getBKTClient,
  initializeBKTClient,
} from '../src/main.browser'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { BKTUser, defineBKTUser } from '../src/BKTUser'
import { FEATURE_ID_STRING, USER_ID } from './constants'
import './assertions'
import { BKTClient, BKTClientImpl } from '../src/BKTClient'
import { DefaultComponent } from '../src/internal/di/Component'
import { EvaluationStorageImpl } from '../src/internal/evaluation/EvaluationStorage'
import { evaluation1 } from '../test/mocks/evaluations'

suite('e2e/BKTClientTest', () => {
  let config: BKTConfig
  let user: BKTUser

  afterEach(() => {
    destroyBKTClient()
    localStorage.clear()
  })

  suite('evaluation update flow', () => {
    beforeEach(async () => {
      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: window.fetch,
      })

      user = defineBKTUser({
        id: USER_ID,
      })

      await initializeBKTClient(config, user)
    })

    test('test', async () => {
      const client = getBKTClient()

      assert(client != null)

      expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')

      client.updateUserAttributes({ app_version: '0.0.1' })

      await client.fetchEvaluations()

      expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-2')

      const detail = client.evaluationDetails(FEATURE_ID_STRING)

      expect(detail).toBeEvaluation({
        id: 'feature-js-e2e-string:5:bucketeer-js-user-id-1',
        featureId: FEATURE_ID_STRING,
        featureVersion: 5,
        userId: USER_ID,
        variationId: '802f2b29-a5c5-47d1-b5ba-f457d224c7b2',
        variationName: 'variation 2',
        variationValue: 'value-2',
        reason: 'RULE',
      })
    })
  })

  suite('forceUpdate', () => {
    beforeEach(async () => {
      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: window.fetch,
      })

      user = defineBKTUser({
        id: USER_ID,
      })

      await initializeBKTClient(config, user)
    })

    test('userEvaluationsId is different and evaluatedAt is too old', async () => {
      const client = getBKTClient()

      assert(client != null)

      const evaluationStorage = getDefaultComponent(
        client,
      ).dataModule.evaluationStorage() as EvaluationStorageImpl

      const current = evaluationStorage.storage.get()

      assert(current != null)

      const randomEvaluationsId = crypto
        .getRandomValues(new Uint8Array(16))
        .join('')
        .slice(0, 19)
        .toString()

      // update evaluations manually, and check if evaluation1 is deleted after fetchEvaluations
      evaluationStorage.storage.set({
        ...current,
        evaluations: { [evaluation1.featureId]: evaluation1 },
        currentEvaluationsId: randomEvaluationsId,
        evaluatedAt: '1',
      })

      const testTarget = evaluationStorage.storage.get()

      assert(testTarget != null)

      expect(testTarget.evaluatedAt).toBe('1')
      expect(testTarget.evaluations[evaluation1.featureId]).toStrictEqual(
        evaluation1,
      )

      await client.fetchEvaluations()

      const updated = evaluationStorage.storage.get()

      assert(updated != null)

      expect(updated.evaluatedAt).not.toBe('1')
      expect(updated.evaluations[evaluation1.featureId]).toBeUndefined()
    })

    test('userEvaluationId is null', async () => {
      const client = getBKTClient()

      assert(client != null)

      const evaluationStorage = getDefaultComponent(
        client,
      ).dataModule.evaluationStorage() as EvaluationStorageImpl

      const current = evaluationStorage.storage.get()

      assert(current != null)

      // update evaluations manually, and check if evaluation1 is deleted after fetchEvaluations
      evaluationStorage.storage.set({
        ...current,
        evaluations: { [evaluation1.featureId]: evaluation1 },
        currentEvaluationsId: null,
      })

      const testTarget = evaluationStorage.storage.get()

      assert(testTarget != null)

      expect(testTarget.currentEvaluationsId).toBeNull()
      expect(testTarget.evaluations[evaluation1.featureId]).toStrictEqual(
        evaluation1,
      )

      await client.fetchEvaluations()

      const updated = evaluationStorage.storage.get()

      assert(updated != null)

      expect(updated.currentEvaluationsId).not.toBeNull()
      expect(updated.evaluations[evaluation1.featureId]).toBeUndefined()
    })
  })

  suite('featureTag', () => {
    beforeEach(async () => {
      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        appVersion: '1.2.3',
        fetch: window.fetch,
      })

      user = defineBKTUser({
        id: USER_ID,
      })

      await initializeBKTClient(config, user)
    })

    test('initialize without featureTag should retieve all features', async () => {
      const client = getBKTClient()

      assert(client != null)

      const javascript = client.evaluationDetails('feature-js-e2e-string')
      expect(javascript).not.toBeNull()

      const javascriptEvaluationDetails = client.stringVariationDetails(
        'feature-js-e2e-string',
        '',
      )
      expect(javascriptEvaluationDetails.variationValue).not.toEqual('')

      // can retrieve evaluations for other featureTag
      const android = client.evaluationDetails('feature-android-e2e-string')
      expect(android).not.toBeNull()

      const androidEvaluationDetails = client.stringVariationDetails(
        'feature-android-e2e-string',
        '',
      )
      expect(androidEvaluationDetails.variationValue).not.toStrictEqual('')

      const golang = client.evaluationDetails('feature-go-server-e2e-1')
      expect(golang).not.toBeNull()

      const golangEvaluationDetails = client.stringVariationDetails(
        'feature-go-server-e2e-1',
        '',
      )
      expect(golangEvaluationDetails.variationValue).not.toStrictEqual('')
    })
  })
})

const getDefaultComponent = (client: BKTClient): DefaultComponent => {
  return (client as BKTClientImpl).component as DefaultComponent
}

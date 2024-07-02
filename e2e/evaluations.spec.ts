import { suite, test, expect, beforeEach, afterEach, assert } from 'vitest'
import {
  destroyBKTClient,
  getBKTClient,
  initializeBKTClient,
} from '../src/main.browser'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { BKTUser, defineBKTUser } from '../src/BKTUser'
import {
  FEATURE_ID_BOOLEAN,
  FEATURE_ID_DOUBLE,
  FEATURE_ID_INT,
  FEATURE_ID_JSON,
  FEATURE_ID_STRING,
  USER_ID,
} from './constants'
import './assertions'

suite('e2e/evaluations', () => {
  let config: BKTConfig
  let user: BKTUser

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

  afterEach(() => {
    destroyBKTClient()
    localStorage.clear()
  })

  suite('stringVariation', () => {
    test('value', () => {
      const client = getBKTClient()

      assert(client != null)

      expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')
    })

    test('detail', () => {
      const client = getBKTClient()

      assert(client != null)

      const detail = client.evaluationDetails(FEATURE_ID_STRING)
      expect(detail).toBeEvaluation({
        id: 'feature-js-e2e-string:5:bucketeer-js-user-id-1',
        featureId: FEATURE_ID_STRING,
        featureVersion: 5,
        userId: USER_ID,
        variationId: '87e0a1ef-a0cb-49da-8460-289948f117ba',
        variationName: 'variation 1',
        variationValue: 'value-1',
        reason: 'DEFAULT',
      })

      const evaluationDetails = client.stringVariationDetails(
        FEATURE_ID_STRING,
        'default',
      )
      expect(evaluationDetails).toStrictEqual({
        featureId: FEATURE_ID_STRING,
        featureVersion: 5,
        userId: USER_ID,
        variationId: '87e0a1ef-a0cb-49da-8460-289948f117ba',
        variationName: 'variation 1',
        variationValue: 'value-1',
        reason: 'DEFAULT',
      })
    })
  })

  suite('numberVariation', () => {
    suite('int', () => {
      test('value', () => {
        const client = getBKTClient()

        assert(client != null)

        expect(client.numberVariation(FEATURE_ID_INT, 0)).toBe(10)
      })

      test('detail', () => {
        const client = getBKTClient()

        assert(client != null)

        const detail = client.evaluationDetails(FEATURE_ID_INT)
        expect(detail).toBeEvaluation({
          id: 'feature-js-e2e-int:3:bucketeer-js-user-id-1',
          featureId: FEATURE_ID_INT,
          featureVersion: 3,
          userId: USER_ID,
          variationId: '6079c503-c281-4561-b870-c2c59a75e6a6',
          variationName: 'variation 10',
          variationValue: '10',
          reason: 'DEFAULT',
        })

        const evaluationDetails = client.numberVariationDetails(
          FEATURE_ID_INT,
          0,
        )
        expect(evaluationDetails).toStrictEqual({
          featureId: FEATURE_ID_INT,
          featureVersion: 3,
          userId: USER_ID,
          variationId: '6079c503-c281-4561-b870-c2c59a75e6a6',
          variationName: 'variation 10',
          variationValue: 10,
          reason: 'DEFAULT',
        })
      })
    })

    suite('double', () => {
      test('value', () => {
        const client = getBKTClient()

        assert(client != null)

        expect(client.numberVariation(FEATURE_ID_DOUBLE, 2.1)).toBe(2.1)
      })

      test('detail', () => {
        const client = getBKTClient()

        assert(client != null)

        const detail = client.evaluationDetails(FEATURE_ID_DOUBLE)
        expect(detail).toBeEvaluation({
          id: 'feature-js-e2e-double:3:bucketeer-js-user-id-1',
          featureId: FEATURE_ID_DOUBLE,
          featureVersion: 3,
          userId: USER_ID,
          variationId: '2d4a213c-1721-434b-8484-1b72826ece98',
          variationName: 'variation 2.1',
          variationValue: '2.1',
          reason: 'DEFAULT',
        })

        const evaluationDetails = client.numberVariationDetails(
          FEATURE_ID_DOUBLE,
          0,
        )
        expect(evaluationDetails).toStrictEqual({
          featureId: FEATURE_ID_DOUBLE,
          featureVersion: 3,
          userId: USER_ID,
          variationId: '2d4a213c-1721-434b-8484-1b72826ece98',
          variationName: 'variation 2.1',
          variationValue: 2.1,
          reason: 'DEFAULT',
        })
      })
    })
  })

  suite('booleanVariation', () => {
    test('value', () => {
      const client = getBKTClient()

      assert(client != null)

      expect(client.booleanVariation(FEATURE_ID_BOOLEAN, false)).toBe(true)
    })

    test('detail', () => {
      const client = getBKTClient()

      assert(client != null)

      const detail = client.evaluationDetails(FEATURE_ID_BOOLEAN)
      expect(detail).toBeEvaluation({
        id: 'feature-js-e2e-boolean:3:bucketeer-js-user-id-1',
        featureId: FEATURE_ID_BOOLEAN,
        featureVersion: 3,
        userId: USER_ID,
        variationId: '4fab39c8-bf62-4a78-8a10-1b8bc3dd3806',
        variationName: 'variation true',
        variationValue: 'true',
        reason: 'DEFAULT',
      })

      const evaluationDetails = client.numberVariationDetails(
        FEATURE_ID_BOOLEAN,
        0,
      )
      expect(evaluationDetails).toStrictEqual({
        featureId: FEATURE_ID_BOOLEAN,
        featureVersion: 3,
        userId: USER_ID,
        variationId: '4fab39c8-bf62-4a78-8a10-1b8bc3dd3806',
        variationName: 'variation true',
        variationValue: true,
        reason: 'DEFAULT',
      })
    })
  })

  suite('jsonVariation', () => {
    test('value', () => {
      const client = getBKTClient()

      assert(client != null)

      expect(client.jsonVariation(FEATURE_ID_JSON, '')).toStrictEqual({
        key: 'value-1',
      })
    })

    test('detail', () => {
      const client = getBKTClient()

      assert(client != null)

      const detail = client.evaluationDetails(FEATURE_ID_JSON)
      expect(detail).toBeEvaluation({
        id: 'feature-js-e2e-json:3:bucketeer-js-user-id-1',
        featureId: FEATURE_ID_JSON,
        featureVersion: 3,
        userId: USER_ID,
        variationId: '8b53a27b-2658-4f8c-925e-fb277808ed30',
        variationName: 'variation 1',
        variationValue: `{ "key": "value-1" }`,
        reason: 'DEFAULT',
      })

      const evaluationDetails = client.objectVariationDetails(
        FEATURE_ID_BOOLEAN,
        {},
      )
      expect(evaluationDetails).toStrictEqual({
        featureId: FEATURE_ID_JSON,
        featureVersion: 3,
        userId: USER_ID,
        variationId: '8b53a27b-2658-4f8c-925e-fb277808ed30',
        variationName: 'variation 1',
        variationValue: { key: 'value-1' },
        reason: 'DEFAULT',
      })
    })
  })
})

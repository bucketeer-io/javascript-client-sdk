import { suite, test, expect, beforeEach, afterEach, assert } from 'vitest'
import {
  destroyBKTClient,
  getBKTClient,
  initializeBKTClient,
} from '../src/BKTClient'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { BKTUser, defineBKTUser } from '../src/BKTUser'
import { FEATURE_ID_STRING, USER_ID } from './constants'
import './assertions'

suite('e2e/BKTClientTest', () => {
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

  test('evaluation update flow', async () => {
    const client = getBKTClient()

    assert(client != null)

    expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')

    client.updateUserAttributes({ app_version: '0.0.1' })

    await client.fetchEvaluations()

    expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-2')

    const detail = client.evaluationDetails(FEATURE_ID_STRING)

    expect(detail).toBeEvaluation({
      id: 'feature-js-e2e-string:3:bucketeer-js-user-id-1',
      featureId: FEATURE_ID_STRING,
      featureVersion: 3,
      userId: USER_ID,
      variationId: '802f2b29-a5c5-47d1-b5ba-f457d224c7b2',
      variationValue: 'value-2',
      reason: 'RULE',
    })
  })
})

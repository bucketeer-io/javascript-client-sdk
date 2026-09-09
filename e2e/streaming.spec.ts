import { suite, test, expect, beforeEach, afterEach, assert, vi } from 'vitest'
import { destroyBKTClient, getBKTClient, initializeBKTClient } from './module'
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
import { TimeoutException } from '../src/BKTExceptions'
import { fetchLike } from './environment'
import { recordingFetch } from './recordingFetch'

suite.skip('e2e/streaming', () => {
  let config: BKTConfig
  let user: BKTUser
  let recorder: ReturnType<typeof recordingFetch>

  beforeEach(() => {
    recorder = recordingFetch(fetchLike)

    config = defineBKTConfig({
      apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
      apiKey: import.meta.env.VITE_BKT_API_KEY,
      featureTag: 'javascript',
      appVersion: '1.2.3',
      fetch: recorder.fetch,
      enableStreaming: true,
      storageKeyPrefix: 'streaming',
    })

    user = defineBKTUser({
      id: USER_ID,
    })
  })

  afterEach(() => {
    destroyBKTClient()
  })

  test(
    'streaming init still delivers correct values',
    async () => {
      await initializeBKTClient(config, user)

      const client = getBKTClient()
      assert(client != null)

      expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')
      expect(client.numberVariation(FEATURE_ID_INT, 0)).toBe(10)
      expect(client.numberVariation(FEATURE_ID_DOUBLE, 0.0)).toBe(2.1)
      expect(client.booleanVariation(FEATURE_ID_BOOLEAN, false)).toBe(true)
      expect(client.jsonVariation(FEATURE_ID_JSON, '')).toStrictEqual({
        key: 'value-1',
      })

      expect(
        recorder.urls.some((u) => u.endsWith('/v1/gateway/stream_evaluations')),
      ).toBe(true)
    },
    30_000,
  )

  test(
    'evaluations arrive over the stream when REST is unavailable',
    async () => {
      // Own storage prefix: initializeCache() loads whatever is already cached
      // under a prefix, and a leftover value from another test would make this
      // pass even if the stream delivered nothing.
      config.storageKeyPrefix = 'streaming-timeout'

      await expect(() =>
        initializeBKTClient(config, user, 1),
      ).rejects.toThrowError(TimeoutException)

      const client = getBKTClient()
      assert(client != null)

      await vi.waitFor(
        () => {
          expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')
        },
        { timeout: 30_000, interval: 500 },
      )

      // The aborted init fetch is the only /get_evaluations call. A second one
      // would mean the polling fallback filled the cache instead of the stream.
      expect(recorder.countOf('/get_evaluations')).toBe(1)
    },
    30_000,
  )

  test(
    'reconnect after updateUserAttributes re-evaluates over the stream',
    async () => {
      // feature-js-e2e-string has a targeting rule on the e2e backend: a user
      // whose app_version attribute is '0.0.1' resolves to variation 2
      // ('value-2') instead of the default variation 1 ('value-1'), with
      // reason 'RULE'. Updating the attribute below re-evaluates this user
      // against that rule, same as e2e/BKTClient.spec.ts's "evaluation update
      // flow" test does over REST; this test goes through the SSE reconnect
      // that updateUserAttributes() triggers instead.
      await initializeBKTClient(config, user)

      const client = getBKTClient()
      assert(client != null)

      expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')

      let listenerCalled = false
      client.addEvaluationUpdateListener(() => {
        listenerCalled = true
      })

      await client.updateUserAttributes({ app_version: '0.0.1' })

      await vi.waitFor(
        () => {
          expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-2')
        },
        { timeout: 30_000, interval: 500 },
      )

      expect(listenerCalled).toBe(true)
      expect(client.evaluationDetails(FEATURE_ID_STRING)?.reason).toBe('RULE')
      expect(recorder.countOf('/get_evaluations')).toBe(1)
    },
    30_000,
  )
})

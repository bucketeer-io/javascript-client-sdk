import { suite, test, expect, beforeEach, afterEach, assert, vi } from 'vitest'
import { destroyBKTClient, getBKTClient, initializeBKTClient } from './module'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { BKTUser, defineBKTUser } from '../src/BKTUser'
import { FEATURE_ID_STRING, USER_ID } from './constants'
import { TimeoutException } from '../src/BKTExceptions'
import { fetchLike } from './environment'
import { recordingFetch, waitForStreamOpen } from './recordingFetch'

suite('e2e/streaming', () => {
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
    'stream connection opens successfully during init',
    async () => {
      await initializeBKTClient(config, user)

      const client = getBKTClient()
      assert(client != null)

      // The stream request is issued before initializeBKTClient() resolves
      // (see BKTClient.ts's scheduleAndFetch()), but its response can still
      // arrive after. waitForStreamOpen only resolves once the stream request
      // settles with ok: true - a 401, a 404, or an aborted request never
      // satisfies this, unlike the old assertion, which only checked that the
      // request was sent.
      //
      // Timeout below the 30_000 test timeout on purpose: the init fetch above
      // already spent part of the clock, so an inner timeout equal to the
      // outer one would always lose the race, and the failure would read as
      // an opaque "test timed out" instead of this assertion's own message.
      await waitForStreamOpen(recorder, 20_000)
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

      // Below the 30_000 test timeout on purpose: the test clock starts before
      // this (the aborted init fetch already ran), so an inner timeout equal
      // to the outer one would always lose the race, and the failure would
      // read as an opaque "test timed out" instead of this assertion's own
      // message.
      await vi.waitFor(
        () => {
          expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')
        },
        { timeout: 20_000, interval: 500 },
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

      // Below the 30_000 test timeout on purpose: the init fetch above already
      // spent part of the clock, so an inner timeout equal to the outer one
      // would always lose the race, and the failure would read as an opaque
      // "test timed out" instead of this assertion's own message.
      await vi.waitFor(
        () => {
          expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-2')
        },
        { timeout: 20_000, interval: 500 },
      )

      expect(listenerCalled).toBe(true)
      expect(client.objectVariationDetails(FEATURE_ID_STRING, {})?.reason).toBe('RULE')

      // The init fetch is the only /get_evaluations call. A second one would
      // mean updateUserAttributes() re-evaluated over a REST re-fetch instead
      // of the SSE reconnect this test is meant to exercise.
      expect(recorder.countOf('/get_evaluations')).toBe(1)
    },
    30_000,
  )
})

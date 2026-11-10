import { suite, test, expect, beforeEach, afterEach, assert, vi } from 'vitest'
import { destroyBKTClient, getBKTClient, initializeBKTClient } from './module'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { BKTUser, defineBKTUser } from '../src/BKTUser'
import { FEATURE_ID_STRING, USER_ID } from './constants'
import { ForbiddenException, TimeoutException } from '../src/BKTExceptions'
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

      // A normal connect reports no failure.
      const status = client.evaluationSyncStatus()
      expect(status.state).toBe('SYNCED')
      expect(status.lastError).toBeNull()
    },
    30_000,
  )

  test(
    'evaluations arrive over the stream when REST is unavailable',
    async () => {
      const timeoutConfig = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: recorder.fetch,
        enableStreaming: true,
        storageKeyPrefix: 'streaming-timeout',
      })

      await expect(() =>
        initializeBKTClient(timeoutConfig, user, 1),
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

      // The stream put recovered the failed init. lastError is kept after
      // recovery, so it still shows why init failed.
      const status = client.evaluationSyncStatus()
      expect(status.state).toBe('SYNCED')
      expect(status.lastError?.cause).toBeInstanceOf(TimeoutException)
      expect(status.lastError?.source).toBe('POLLING')
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
      expect(client.stringVariationDetails(FEATURE_ID_STRING, '')?.reason).toBe('RULE')

      // The init fetch is the only /get_evaluations call. A second one would
      // mean updateUserAttributes() re-evaluated over a REST re-fetch instead
      // of the SSE reconnect this test is meant to exercise.
      expect(recorder.countOf('/get_evaluations')).toBe(1)
    },
    30_000,
  )

  test(
    'a wrong API key gives FAILING with the polling ForbiddenException',
    async () => {
      const wrongKeyConfig = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: 'wrong-api-key',
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: recorder.fetch,
        enableStreaming: true,
        storageKeyPrefix: 'streaming-wrong-key',
      })

      // The backend answers a wrong key with 403 on get_evaluations and 401 on
      // the stream.
      await expect(() =>
        initializeBKTClient(wrongKeyConfig, user),
      ).rejects.toThrowError(ForbiddenException)

      const client = getBKTClient()
      assert(client != null)

      // lastError keeps only the last error. What happens, in order:
      // 1. The stream gets 401: lastError is UnauthorizedException (STREAMING),
      //    and listeners are called with it.
      // 2. The init poll gets 403: lastError is ForbiddenException (POLLING).
      //    Steps 1 and 2 can arrive in either order.
      // 3. A 401 stops the stream for good, so StreamingTask starts the polling
      //    fallback, which polls at once. From now on, stream failures are
      //    ignored, because the polling fallback decides the status.
      // 4. The fallback poll gets 403: lastError is ForbiddenException (POLLING).
      // Step 4 always comes after step 1, so the status always ends on the
      // polling error. waitFor waits for step 4.
      await vi.waitFor(
        () => {
          expect(recorder.responseFor('/stream_evaluations')?.status).toBe(401)
          const status = client.evaluationSyncStatus()
          expect(status.state).toBe('FAILING')
          expect(status.lastSyncedAt).toBeNull()
          expect(status.lastError?.cause).toBeInstanceOf(ForbiddenException)
          expect(status.lastError?.source).toBe('POLLING')
        },
        { timeout: 20_000, interval: 200 },
      )
    },
    30_000,
  )
})

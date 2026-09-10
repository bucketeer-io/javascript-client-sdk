import { suite, test, expect, afterEach, assert, vi } from 'vitest'
import { destroyBKTClient, getBKTClient, initializeBKTClient } from './module'
import { defineBKTConfig } from '../src/BKTConfig'
import { defineBKTUser } from '../src/BKTUser'
import { FEATURE_ID_STREAMING, USER_ID } from './constants'
import { fetchLike } from './environment'
import { recordingFetch } from './recordingFetch'
import { setVariationValue, streamingTestToken } from './featureFlagApi'

suite('e2e/streamingPatch', () => {
  afterEach(() => {
    destroyBKTClient()
  })

  test(
    'a server-pushed patch is delivered to the open stream',
    async () => {
      const recorder = recordingFetch(fetchLike)

      const config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: recorder.fetch,
        enableStreaming: true,
        storageKeyPrefix: 'streaming-patch',
      })

      const user = defineBKTUser({
        id: USER_ID,
      })

      await initializeBKTClient(config, user)

      const client = getBKTClient()
      assert(client != null)

      // Both fields are needed: the server replaces the whole variation object,
      // so the write must resend the existing name along with the new value.
      const evaluation = client.objectVariationDetails(FEATURE_ID_STREAMING, {})
      assert(evaluation != null)
      const { variationId, variationName } = evaluation

      const token = streamingTestToken()

      // Record every value the stream delivers, instead of only reading the
      // latest one. An overlapping run can overwrite the value moments after
      // our patch lands, so reading only the current value could miss it.
      const observed: string[] = []
      client.addEvaluationUpdateListener(() => {
        observed.push(client.stringVariation(FEATURE_ID_STREAMING, ''))
      })

      await setVariationValue(
        FEATURE_ID_STREAMING,
        variationId,
        variationName,
        token,
      )

      // Below the 30_000 test timeout on purpose: init and the PATCH write
      // above already spent part of the clock, so an inner timeout equal to
      // the outer one would always lose the race, and the failure would read
      // as an opaque "test timed out" instead of this assertion's own
      // message.
      await vi.waitFor(
        () => {
          expect(observed).toContain(token)
        },
        { timeout: 20_000, interval: 500 },
      )

      // Arrived by patch, not by a poll.
      expect(recorder.countOf('/get_evaluations')).toBe(1)
    },
    30_000,
  )
})

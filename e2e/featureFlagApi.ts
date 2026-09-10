import { fetchLike } from './environment'

export const publicApiKey = import.meta.env.VITE_BKT_PUBLIC_API_KEY
if (!publicApiKey) {
  throw new Error('VITE_BKT_PUBLIC_API_KEY is not set (needed by e2e/streamingPatch.spec.ts)')
}

// Unique per run, so two overlapping e2e runs never wait for the same value.
export const streamingTestToken = () =>
  `sse-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// The written value is never restored after the test runs. That's intentional,
// not an oversight: every caller passes a fresh, disposable value (see
// streamingTestToken()), never a value any test depends on reading back later,
// and every PATCH bumps the flag's version on the backend regardless of what
// the previous value was. So there is no baseline to drift away from, and
// leaving the flag on the last run's value doesn't affect any later run.
export const setVariationValue = async (
  featureId: string,
  variationId: string,
  variationName: string,
  value: string,
) => {
  const res = await fetchLike(`${import.meta.env.VITE_BKT_API_ENDPOINT}/v1/feature`, {
    method: 'PATCH',
    headers: { authorization: publicApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: featureId,
      comment: 'js e2e streaming test',
      variationChanges: [
        // name is REQUIRED. The server replaces the whole variation object
        // rather than merging fields, and rejects an empty name.
        {
          changeType: 'UPDATE',
          variation: { id: variationId, name: variationName, value },
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`failed to update ${featureId}: ${res.status} ${res.statusText}`)
}

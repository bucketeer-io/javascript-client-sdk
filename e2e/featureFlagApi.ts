import { fetchLike } from './environment'

export const publicApiKey = import.meta.env.VITE_BKT_PUBLIC_API_KEY

// Unique per run, so two overlapping e2e runs never wait for the same value.
export const streamingTestToken = () =>
  `sse-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

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

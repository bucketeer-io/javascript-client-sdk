export function isRecoverableStatus(status: number | undefined): boolean {
  if (status === undefined) {
    return true
  }
  if (status >= 400 && status < 500) {
    // 499 ("client closed request") is a deployment-related status post.ts
    // already retries for the polling API (ClientClosedRequestException) — a
    // backend rollout that polling survives must not kill the stream instead.
    return (
      status === 400 || status === 408 || status === 429 || status === 499
    )
  }
  return true
}

// Statuses where retrying the exact same request can never produce a different
// outcome: auth failures (401/403), and 4xx responses tied to the fixed shape of
// the request itself (method/headers/body) rather than transient server state.
// 404 is included deliberately: unlike the deployment-related 499 that `post.ts`
// retries for the polling API, this codebase has no established convention that
// treats 404 as a signal of an in-progress backend rollout, so it gets no benefit
// of the doubt here.
const TERMINAL_STATUSES = new Set([
  401, // Unauthorized — bad API key
  403, // Forbidden — bad API key
  404, // Not Found — same URL, will not appear on its own
  405, // Method Not Allowed — same method every request
  406, // Not Acceptable — same fixed Accept header every request
  410, // Gone — permanent by definition
  413, // Payload Too Large — same body every request
  414, // URI Too Long — malformed URL, won't self-resolve
  415, // Unsupported Media Type — same fixed Content-Type every request
  422, // Unprocessable Entity — same body fails validation every request
  431, // Request Header Fields Too Large — same headers every request
  451, // Unavailable For Legal Reasons — permanent
])

export function isTerminalStatus(status: number | undefined): boolean {
  return status !== undefined && TERMINAL_STATUSES.has(status)
}

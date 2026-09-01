/**
 * Retry classification for SSE stream HTTP statuses.
 *
 * There are THREE categories, but only two are named as sets below. The third
 * is the default, defined by absence from both (easy to miss when adding a
 * status, so read this first).
 *
 * The single consumer is StreamConnection.onerror, which branches in this order:
 *
 *   1. RETRY FAST (isRecoverableStatus() returns true)
 *      Backoff retries (1s to 30s, jittered), bounded by a 120s unhealthy
 *      window, then falls through to category 2.
 *      Use for failures that fix themselves in SECONDS.
 *
 *   2. RETRY SLOW (in NEITHER set: the default for any unlisted 4xx)
 *      Give up on this attempt immediately. StreamingTask starts the polling
 *      fallback and arms a 5-minute streaming recovery timer, and reconnect()
 *      from updateUserAttributes() can reopen the stream at any time.
 *      Use for failures that fix themselves in MINUTES, or only when the app
 *      acts.
 *
 *   3. NEVER RETRY (isTerminalStatus() returns true)
 *      Permanent. StreamingTask sets terminalFailure, which is never reset, so
 *      BOTH the recovery timer and reconnect() are dead for the life of the
 *      task. Only destroy + re-initialize brings streaming back.
 *
 * To pick a category, ask what would have to CHANGE for a retry to succeed, and
 * how fast that thing changes.
 *
 * WHICH FIELD MATTERS: StreamingTask.buildRequest() rebuilds the request on
 * every reconnect, but only part of it actually varies: user.data changes on
 * every updateUserAttributes() call, and userEvaluationsId/evaluatedAt change
 * as the cache refreshes. Both are far too slow for category 1, but are
 * reached by category 2. The REST of the body (tag, user.id, sourceId,
 * sdkVersion) cannot change while the client runs, no less than the API key,
 * URL, method, or headers can: none of the six has a public API that mutates
 * it on a live instance, only destroy + re-initialize can produce a different
 * value, and that starts a new client with a fresh StreamingTask, not a
 * change visible to this one.
 *
 * WHY CATEGORY 2, NOT 1 OR 3: "the status depends on the body" is not proof
 * that a retry can eventually succeed. A 400 caused by a malformed tag fails
 * forever, while a 400 caused by a stale evaluatedAt does not, and the SDK
 * cannot tell which field the backend objected to. Category 2 is the
 * conservative choice for exactly that ambiguity. Getting it wrong costs one
 * request per recovery interval when the cause is permanent; category 3
 * would permanently disable streaming when the cause was in fact recoverable.
 * Reserve category 3 for statuses decided entirely by parts of the REQUEST
 * that this client cannot vary.
 *
 * DEPENDS ON THE POLLING FALLBACK: category 2's "reached by category 2"
 * promise above only holds if something is actually doing the refreshing.
 * Only the polling fallback writes a new evaluatedAt, the SSE connection
 * itself never does, so that half of the promise depends on
 * streamingFallbackToPolling staying enabled. With it off, a status caused
 * by a stale evaluatedAt never self-corrects: category 2 just resends the
 * identical failing body every recovery interval, forever.
 *
 * CATEGORY 3 HAS THE SAME LIMIT: "cannot vary" above means the REQUEST, not
 * the world. Several category 3 entries (404, 405, 406, 415) would also
 * resolve if the SERVER changed, e.g. a backend deploy that adds the route.
 * They stay terminal anyway, on the same reasoning as the 404 note below:
 * this codebase does not treat those as rollout signals, and the cost of
 * being wrong is bounded (streaming stays off, polling carries on) until the
 * app restarts.
 */

export function isRecoverableStatus(status: number | undefined): boolean {
  if (status === undefined) {
    return true
  }
  if (status >= 400 && status < 500) {
    // 499 ("client closed request") is a deployment-related status post.ts
    // already retries for the polling API (ClientClosedRequestException): a
    // backend rollout that polling survives must not kill the stream instead.
    //
    // 400 is deliberately absent: it's decided by the request BODY
    // (attributes, cache state), which cannot change inside this loop's 120s
    // window, so every fast retry would just resend the same failing request.
    // See category 2 in the file header.
    return status === 408 || status === 429 || status === 499
  }
  return true
}

// Statuses where retrying the exact same request can never produce a different
// outcome: decided by a part of the request that cannot change while the client
// runs (the API key, the URL, the method, or a fixed header) rather than by
// transient server state. 404 is included deliberately: unlike the
// deployment-related 499 that `post.ts` retries for the polling API, this
// codebase has no established convention that treats 404 as a signal of an
// in-progress backend rollout, so it gets no benefit of the doubt here.
//
// 400, 413, and 422 are deliberately absent: all three are decided by the
// request BODY, and part of that body is mutable (user.data via
// updateUserAttributes(), userEvaluationsId/evaluatedAt as the cache
// refreshes), so a later attempt MAY differ. It may also not: the same three
// statuses can be caused by the body's fixed fields (tag, user.id, sourceId,
// sdkVersion), and the SDK cannot tell which. They get category 2 because that
// ambiguity is cheap to be wrong about in one direction and expensive in the
// other. See the file header.
const TERMINAL_STATUSES = new Set([
  401, // Unauthorized: bad API key
  403, // Forbidden: bad API key
  404, // Not Found: same URL, will not appear on its own
  405, // Method Not Allowed: same method every request
  406, // Not Acceptable: same fixed Accept header every request
  410, // Gone: permanent by definition
  414, // URI Too Long: malformed URL, won't self-resolve
  415, // Unsupported Media Type: same fixed Content-Type every request
  431, // Request Header Fields Too Large: same headers every request
  451, // Unavailable For Legal Reasons: permanent
])

export function isTerminalStatus(status: number | undefined): boolean {
  return status !== undefined && TERMINAL_STATUSES.has(status)
}

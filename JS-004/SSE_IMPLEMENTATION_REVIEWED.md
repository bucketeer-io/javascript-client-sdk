# SSE Implementation Plan — Review

Review of [`SSE_IMPLEMENTAION.md`](./SSE_IMPLEMENTAION.md), validated against the
actual SDK source. This is a design-doc review: findings are places where the
plan's assumptions or proposed mechanics conflict with the real codebase or with
how the native `EventSource` actually behaves. Ranked most-severe first.

**Verdict:** the file-level structure (opt-in config, reuse of
`GetEvaluationsResponse`, extracting `applyEvaluationsResponse`, scheduler swap)
is sound and backward-compatible. The blocking problems are all in the **runtime
connection lifecycle**. As written, the plan would: reconnect-loop while idle,
fall back to polling on the first network blip, and never reconnect on attribute
changes. Resolve findings #1–#5 before implementation.

---

## Findings

### 1. Heartbeat comments don't fire `onmessage` → watchdog reconnect loop (critical)

The plan treats heartbeats as `: heartbeat` SSE **comment** lines that the SDK
"ignores (native behavior)" (`SSE_IMPLEMENTAION.md` L12), but the Gap-3 watchdog
is only reset by `onopen` / `onmessage` (L87–88, L168–171).

Native `EventSource` does **not** invoke `onmessage` for comment lines. So during
any idle period where the server sends only heartbeats and no evaluation data,
the watchdog is never reset and fires every ~60 s, force-reconnecting forever —
the exact opposite of its purpose.

**Fix:** give the watchdog a signal the heartbeat actually produces. Either have
the server send heartbeats as a real named event / data payload (so `onmessage`
or an `addEventListener('heartbeat')` handler resets the timer), or drop the
comment-based heartbeat design entirely.

---

### 2. `onerror` → polling fallback permanently kills native auto-reconnect (critical)

Native `EventSource` fires `onerror` on **every** transient disconnect while it
auto-reconnects (readyState `CONNECTING`). Section 3 says: if
`streamingFallbackToPolling`, `stop()` then start `EvaluationTask` (L178). Since
`streamingFallbackToPolling` defaults to `true` (L122), the **first** network
blip tears down streaming and drops to polling permanently — directly
contradicting the reconnect table that claims native auto-reconnect handles
transient disconnects (L238).

**Fix:** the handler must distinguish "never opened" (backend lacks SSE → fall
back) from "was open, transient drop" (let native auto-reconnect run). Track an
`openedOnce` flag (set in `onopen`) and/or inspect `readyState` inside `onerror`;
only fall back to polling when the connection has never successfully opened.

---

### 3. Gap 1: `applyEvaluationsResponse` clears the flag before the reconnect check (critical)

`onmessage` calls `applyEvaluationsResponse` (step 3) then checks
`userAttributesUpdated()` (step 4) (L170–174, sequence L89–96). But the extracted
apply block contains `clearUserAttributesUpdated()`
(`src/internal/evaluation/EvaluationInteractor.ts` L76), so the flag is **always
false** by the time it's checked → reconnect-on-attribute-change never fires.

Worse, the trigger is in the wrong place entirely: attributes change via
`updateUserAttributes()` (`src/BKTClient.ts` L177–182), independently of incoming
SSE messages. If no message arrives after the change, the SSE URL keeps stale
attributes forever.

**Fix:** drive the reconnect from the attribute-update path, not from
`onmessage`. When `updateUserAttributes()` runs and streaming is active, signal
`StreamingTask` to `stop()` + `start()` with a freshly built URL. Do not rely on
the `userAttributesUpdated` storage flag for this, since `applyEvaluationsResponse`
clears it as part of normal cache updates.

---

### 4. `userAttributesUpdated(): boolean` does not exist on the interactor (factual error)

The Key Technical Facts table (L34) and Gap 1 (L17) assert a synchronous
`userAttributesUpdated(): boolean` on `EvaluationInteractor`. It doesn't exist —
the interactor only has `setUserAttributesUpdated()`
(`EvaluationInteractor.ts` L90). The read is
`evaluationStorage.getUserAttributesUpdated()`, which is **async** and
Mutex-guarded (`EvaluationStorage.ts` L193–198). The StreamingTask pseudo-code
calling a sync getter (L174) won't compile as written.

**Fix:** add an explicit interactor accessor (e.g.
`async getUserAttributesUpdated(): Promise<boolean>` delegating to storage) and
`await` it — but note that, per finding #3, this check should not live in
`onmessage` at all.

---

### 5. Fallback `EvaluationTask` is unmanaged → keeps polling after `destroy()` (leak)

`TaskScheduler.stop()` only stops tasks in its own array
(`src/internal/scheduler/TaskScheduler.ts` L20–22), and `resetTasks()` just calls
`taskScheduler.stop()` (`BKTClient.ts` L310–315). The plan has `StreamingTask`
spawn a fresh `EvaluationTask` internally on fallback (L178), but
`StreamingTask.stop()` only cancels the watchdog and closes the EventSource
(L180). So after fallback, calling `destroy()` never stops the polling timer — it
keeps firing.

**Fix:** have `StreamingTask` own the fallback `EvaluationTask` as a field and
stop it inside `StreamingTask.stop()` (alongside the watchdog and EventSource
close), so the whole chain shuts down through `resetTasks()`.

---

### 6. Interface exposes only `onmessage`, foreclosing named SSE events

`EventSourceInstance` offers `onmessage` only — no `addEventListener` (L144–150).
Native `onmessage` fires only for unnamed / `message` events. If the backend
emits named events (`event: evaluations`), no data is ever received. Since the
SSE event-naming contract is a noted backend dependency, the interface shouldn't
lock out the named-event case before that contract is fixed.

**Fix:** add `addEventListener(type, listener)` / `removeEventListener` to
`EventSourceLike` (both `eventsource` and `react-native-sse` support it) and
confirm the event name(s) the backend will emit.

---

### 7. `PlatformModule.eventSource()` is unimplementable for Node and redundant

The plan adds `eventSource()` to `PlatformModule`, with the Node variant
"returns `config.eventSource`" (L202–206). But `NodePlatformModule` /
`BasePlatformModule` receive **no config** — they only take `idGenerator`. There's
no `config` reference to return. It's also redundant: `eventSource` already lives
on `BKTConfig` (L120) and `StreamingTask` holds `Component` → `config()`.

**Fix:** drop the `PlatformModule.eventSource()` injection point and read the
resolved `eventSource` straight from `config()` in `StreamingTask`. (If a
platform indirection is genuinely wanted, config must first be threaded into the
platform modules — currently it is not.)

---

### 8. `apiKey` in the URL query string (browser) is a credential-exposure risk

Browser native `EventSource` can't send headers, so the plan appends `apiKey=…`
to the URL (L166, L227). Query-string secrets land in server access logs, proxy
logs, and browser history — unlike the existing header-based auth
(`src/internal/remote/ApiClient.ts` L122–125). This is a regression from the
header-only auth posture.

**Fix:** add an explicit security note; confirm the backend accepts (and the team
accepts logging) a query-param key. Prefer short-lived/scoped keys for the
streaming endpoint if available.

---

## Summary table

| # | Severity | Area | Issue |
|---|---|---|---|
| 1 | Critical | Watchdog | Heartbeat comments don't fire `onmessage` → reconnect loop while idle |
| 2 | Critical | Reconnect | `onerror` fallback kills native auto-reconnect on first blip |
| 3 | Critical | Gap 1 | Flag cleared before check; reconnect trigger in wrong place |
| 4 | High | Gap 1 | `userAttributesUpdated()` sync getter doesn't exist (it's async, on storage) |
| 5 | High | Lifecycle | Fallback `EvaluationTask` not stopped on `destroy()` → polling leak |
| 6 | Medium | Interface | `onmessage`-only forecloses named SSE events |
| 7 | Medium | DI | `PlatformModule.eventSource()` unimplementable for Node + redundant |
| 8 | Medium | Security | `apiKey` in URL query string (browser) |

---

## Source references checked

- `src/BKTConfig.ts` — `defineBKTConfig`, validation block, result literal
- `src/internal/evaluation/EvaluationInteractor.ts` — `fetch` L51–81, `setUserAttributesUpdated`
- `src/internal/evaluation/EvaluationStorage.ts` — `get/set/clearUserAttributesUpdated` (async, Mutex)
- `src/internal/scheduler/TaskScheduler.ts` — fixed `[EvaluationTask, EventTask]`, `stop()`
- `src/internal/scheduler/EvaluationTask.ts` — `setTimeout` polling + retry
- `src/internal/di/PlatformModule{,.browser,.node}.ts` — no `config` reference
- `src/internal/remote/ApiClient.ts` — `Authorization` header auth (L122–125)
- `src/BKTClient.ts` — `updateUserAttributes` L177–182, `scheduleTasks`/`resetTasks` L305–315

# SSE Implementation V2 vs. LaunchDarkly JS SDK — Comparison

Companion to [`SSE_IMPLEMENTATION_V2.md`](./SSE_IMPLEMENTATION_V2.md).

Reviews how the LaunchDarkly **client-side** JS SDK (`js-core`, cloned at `./js-core`)
implements streaming flag updates, then compares it against the Bucketeer V2 plan and
recommends concrete changes.

> Scope note: LaunchDarkly's repo contains both a server SDK (`packages/shared/sdk-server`)
> and a client SDK (`packages/shared/sdk-client`). The client SDK is the relevant
> analog for the browser/Node/React-Native Bucketeer SDK, so this report focuses there.
> Files cited are from `js-core/packages/...`.

---

## Part 1 — How LaunchDarkly Implements SSE

### 1.1 Layered architecture: processor vs. transport

LaunchDarkly separates streaming into **two layers**, which is the single most
important structural difference from the V2 plan:

| Layer | File | Responsibility |
|---|---|---|
| **`StreamingProcessor`** (protocol) | `sdk-client/src/streaming/StreamingProcessor.ts` | Builds the stream URI, registers named-event listeners, deserializes payloads, routes them to data handlers, records diagnostics. **Knows nothing about reconnection or timers.** |
| **`EventSource`** (transport) | `sdk/browser/src/platform/DefaultBrowserEventSource.ts`, `react-native/.../react-native-sse/EventSource.ts`, node's `launchdarkly-eventsource` | Owns the actual connection: open, **reconnect with backoff + jitter**, read-timeout, error filtering. |

The transport is supplied per-platform via `Requests.createEventSource(url, initDict)`
(`sdk/browser/src/platform/BrowserRequests.ts`). The processor is platform-agnostic and
constructed from an injected `Requests` object. The interface contract lives in
`shared/common/src/api/platform/EventSource.ts`:

```ts
export interface EventSource {
  onclose, onerror, onopen, onretrying     // lifecycle callbacks
  addEventListener(type, listener): void
  close(): void
}
export interface EventSourceInitDict {
  method?, headers, body?,
  errorFilter: (err) => boolean,           // decides retry vs. give up
  initialRetryDelayMillis,
  readTimeoutMillis,                        // <-- the "watchdog"
  retryResetIntervalMillis,
  urlBuilder?: () => string,                // <-- fresh URL per reconnect
}
```

Key consequence: **all reconnection logic is inside the EventSource transport, not in
the processor.** The processor's `start()` just wires listeners; its `stop()` just calls
`close()` and sets a `_stopped` guard.

### 1.2 Reconnection: backoff + jitter, not a fixed loop

`DefaultBrowserEventSource` wraps the browser's native `EventSource` and adds its **own**
reconnection (it does not rely on the browser's built-in auto-reconnect):

- On `onerror`, it calls `_handleError`: `close()` the underlying ES, consult
  `errorFilter`, and if retryable schedule `_tryConnect(this._backoff.fail())`.
- `DefaultBackoff` produces exponentially increasing delays with **jitter** (50–100% of
  computed delay) and a max cap; `retryResetIntervalMillis` (60 s) resets the backoff
  after a sufficiently long healthy connection.
- `onretrying` fires a callback with the delay so the processor can log it.
- On reconnect, if a `urlBuilder` was supplied, it rebuilds the URL — so query params
  (LD uses a `basis`/selector value) are refreshed on every reconnect.

`react-native-sse`'s `EventSource` does the same internally (`backoff()` + `jitter()`,
`maxRetryDelay = 30s`, `_getNextRetryDelay`, `_tryConnect`).

### 1.3 The "watchdog": a read-timeout inside the transport

LaunchDarkly does **not** run a separate heartbeat-watchdog timer in the processor.
Instead the transport enforces a **read timeout** (`readTimeoutMillis`, set to
`5 * 60 * 1000` in `StreamingProcessor.start()`). If no bytes arrive within that window,
the transport treats it as a dead connection and reconnects. The server keeps the
connection alive with periodic comments/events; any traffic resets the read timer.
(The browser transport notes it does *not* support a read timeout; the node transport
does.)

### 1.4 Named events carry the full payload (browser client)

The processor registers a listener per logical event via a `Map<EventName, ProcessStreamResponse>`:

```ts
this._listeners.forEach(({ deserializeData, processJson }, eventName) => {
  eventSource.addEventListener(eventName, (event) => {
    if (this._stopped) { ...skip... }
    if (event?.data) { processJson(deserializeData(event.data)) }
  })
})
```

The **browser client SDK** registers `put` (full state), `patch` and `delete`
(incremental) — `DataManager.ts:227-247`. The flag data arrives **inline over the
stream**; the browser SDK does not poke-then-fetch.

> Note (verified): the shared processor also contains a `ping` listener that performs a
> one-shot poll instead of carrying data. **This is not the browser default**, and it
> requires the backend to emit a `ping` event. Bucketeer cannot change the backend and
> will not introduce a new event type, so this pattern is **out of scope** and is not
> used as a basis for any suggestion below. It is recorded here only for completeness.

### 1.5 Streaming ↔ polling: an orchestrated fallback, not a one-way switch

This is LaunchDarkly's most sophisticated piece. In the FDv2 data system
(`sdk-client/src/datasource/fdv2/`), streaming and polling are **synchronizer slots**
coordinated by an orchestrator (`FDv2DataSource.ts`) using timed **conditions**
(`Conditions.ts`):

- **Fallback condition** (`DEFAULT_FALLBACK_TIMEOUT_MS = 120 s`): if the primary
  synchronizer (streaming) can't stay healthy, the orchestrator moves to the next
  synchronizer (polling).
- **Recovery condition** (`DEFAULT_RECOVERY_TIMEOUT_MS = 300 s`): after a period on the
  fallback, it resets back to the primary (streaming).

Connection **modes** (`api/datasource/FDv2ConnectionMode.ts`) compose these pipelines:

> `streaming` — Initializes from cache then polling. **Synchronizes via streaming with
> polling fallback.** … `polling` — synchronizes via polling. `offline` — no
> synchronizers. `background` — polling at reduced frequency (1h).

So fallback is **automatic, bidirectional, and time-boxed** — not a permanent decision
made on the first error.

### 1.6 Error classification decides retry vs. give up

`errorFilter` ultimately calls `shouldRetry` → `isHttpRecoverable`
(`shared/common/src/{utils/http,errors}.ts`): 4xx are fatal **except** 400/408/429;
everything else (5xx, network) is retryable. This governs whether the transport keeps
reconnecting or surfaces a permanent failure.

### 1.7 Per-platform transport & auth

| Platform | Transport | Headers? | Notes |
|---|---|---|---|
| Browser | `DefaultBrowserEventSource` (wraps native `EventSource`) | **No** (`getEventSourceCapabilities().headers = false`) | Custom backoff added on top of native ES |
| Node | `launchdarkly-eventsource` npm pkg | Yes | Supports proxy, TLS, gzip, read-timeout |
| React Native | vendored `react-native-sse` (XHR-based) | Yes | Own backoff+jitter, `urlBuilder` support |

Capabilities are advertised via `getEventSourceCapabilities()` so the processor can adapt
(e.g. fall back to a GET-with-path encoding when `customMethod`/`headers` aren't available)
— a cleaner abstraction than runtime `=== globalThis.EventSource` sniffing.

---

## Part 2 — Comparison with the V2 Plan

### 2.1 What's similar

| Area | Both do this |
|---|---|
| **Opt-in, polling-default** | V2 `enableStreaming: false` default; LD treats streaming as one connection mode among several. Streaming is additive, not a breaking change. |
| **Injected `EventSource` constructor/factory** | V2 reads `config.eventSource ?? globalThis.EventSource`; LD injects via `Requests.createEventSource`. Same goal: platform-supplied transport, browser uses native, Node/RN bring a package. |
| **`EventSourceLike` interface with `addEventListener`** | V2's finding #6 fix matches LD's `EventSource` interface exactly — named events are first-class. |
| **Named events over comments** | V2 mandates a named `heartbeat` event (not `: comment`); LD relies entirely on named events (`put`/`patch`/`ping`) and never on comments for app logic. Same correct instinct. |
| **One apply path for streamed + polled data** | V2 reuses `GetEvaluationsResponse` and extracts `applyEvaluationsResponse`, called by both polling `fetch` and streaming; LD routes every `put`/`patch`/`delete` through the same `_dataSourceEventHandler` used by polling. Both keep a single apply path. |
| **Auth differs by platform** | V2: query-param on browser, header on Node/RN. LD: identical split (browser ES can't set headers). |
| **Stop guard** | V2 `running`/`stop()`; LD `_stopped` flag + `close()`. Both guard against events arriving after teardown. |
| **URL rebuilt on reconnect for fresh attributes** | V2 rebuilds URL in `start()` on attribute-change reconnect; LD has a dedicated `urlBuilder` callback invoked on every reconnect. Same requirement, different mechanism. |

### 2.2 What's different

| Dimension | LaunchDarkly | Bucketeer V2 plan | Why it matters |
|---|---|---|---|
| **Reconnect ownership** | Inside the **transport** (EventSource impl), with **backoff + jitter** | Partly in `StreamingTask` (watchdog → `start()`), partly relies on **native browser auto-reconnect** | V2 mixes two reconnect engines (native ES + its own watchdog) → harder to reason about; LD centralizes it in one place per platform. |
| **Backoff strategy** | Exponential backoff **with jitter**, cap, reset-after-healthy | Watchdog is a **fixed 60 s** reconnect; fallback path has no backoff at all | V2 risks thundering-herd / tight reconnect loops against a struggling backend. No jitter. |
| **Idle detection** | **Read-timeout** in transport (5 min); any byte resets it | App-level **heartbeat watchdog** (60 s) requiring a *named* `heartbeat` event | V2's approach forces a backend contract (named heartbeat). LD's read-timeout works with comments or any traffic, needing no special event. |
| **Streaming↔polling fallback** | **Bidirectional, time-boxed** (120 s fallback / 300 s recovery), orchestrated | **One-way, permanent** — only falls back if SSE *never* opens (`!openedOnce`); once polling, never returns to streaming | V2 never recovers streaming after a long outage that trips fallback. A user who briefly lost SSE before first open is stuck polling forever. |
| **Error classification** | `isHttpRecoverable` — 4xx fatal except 400/408/429 | `onerror` is opaque (browser ES gives no status); decision is purely `openedOnce` | V2 can't distinguish "401 bad key" (should stop) from "503 transient" (should retry). It will keep trying a dead/forbidden endpoint, or fall back when it shouldn't. |
| **Layering** | Processor (protocol) ⟂ Transport (connection) — clean seam, unit-testable in isolation | `StreamingTask` owns URL building, listeners, watchdog, fallback ownership, **and** lifecycle | V2's `StreamingTask` is a god-object; harder to test the connection logic without the interactor. |
| **Capability detection** | Explicit `getEventSourceCapabilities()` (headers/customMethod/readTimeout) | Runtime `EventSourceCtor === globalThis.EventSource` sniffing | Sniffing is brittle (polyfills, SSR, jsdom). Capability flags are explicit and testable. |

### 2.3 Where V2 is arguably *better* / equivalent for Bucketeer's scope

- V2's **explicit attribute-change → `reconnect()`** wiring from `updateUserAttributes`
  is clear and matches the RFC. LD achieves the equivalent implicitly via `urlBuilder`,
  which is more magical. For Bucketeer's smaller surface, V2's explicit call is fine.
- V2 deliberately **avoids** the FDv2 orchestrator complexity. LD's condition/orchestrator
  machinery is heavy; Bucketeer doesn't need full bidirectional orchestration on day one.
- V2's `applyEvaluationsResponse` extraction is the right minimal refactor and mirrors
  LD's "one apply path" principle.

---

## Part 3 — Suggestions

Ordered by impact. **All are client-side only** — none requires a backend change or a
new event type, and each stays within V2's existing structure (it tunes the
`StreamingTask` you already designed, rather than replacing the architecture).

### S1 — Add backoff + jitter to *every* reconnect path (High)
The fixed 60 s watchdog-reconnect and the bare fallback path should both use exponential
backoff with jitter and a healthy-connection reset, mirroring `DefaultBackoff` /
`react-native-sse`'s `backoff()+jitter()`. Without jitter, all clients reconnect in
lockstep after a backend blip. This is the highest-value, lowest-cost borrow.

### S2 — Make polling fallback recoverable (High)
V2's one-way `!openedOnce → polling forever` is a real regression vs. LD. At minimum, add
a **recovery timer**: after N minutes on the fallback `EvaluationTask`, stop it and retry
streaming. You don't need LD's full orchestrator — a single recovery timeout (e.g. 300 s,
matching LD's default) on `StreamingTask` is enough. Document that fallback is temporary.

### S3 — Classify errors before deciding to retry vs. give up (High)
The browser native `EventSource.onerror` exposes no status, which is exactly why LD wraps
it. Consider wrapping the browser ES (LD-style) so a definitive `401/403` (bad/expired
key) **stops** rather than reconnect-loops, while `5xx`/network retries with backoff.
Reuse the existing `isHttpRecoverable`-style table. At minimum, document that without a
status the SDK cannot tell a forbidden key from a transient drop.

### S4 — Split `StreamingTask` into transport + processor (Medium)
Extract the connection lifecycle (open/reconnect/backoff/watchdog) into an
`EventSourceController`-style object behind `EventSourceLike`, leaving `StreamingTask`
to wire listeners and call `applyEvaluationsResponse`. This mirrors LD's processor/transport
seam and makes the connection logic unit-testable without the interactor — directly
serving several of V2's own test scenarios.

### S5 — Replace `=== globalThis.EventSource` sniffing with a capability flag (Medium)
Add an optional `eventSourceCapabilities` (or a `supportsHeaders` boolean) alongside the
injected `eventSource`, defaulting to header-support **off** only for the browser-native
path. Explicit capabilities are how LD avoids brittle identity checks and survive
polyfills / jsdom / SSR. This also makes the auth-mechanism choice testable.

### S6 — Reset idle detection on *any* received bytes (a read-timeout), not only a named heartbeat (Medium)
**No backend change. Works with whatever keep-alive the backend already sends.**

V2's watchdog resets only on `onopen` / `onmessage` / a **named** `heartbeat` event. That
re-introduces V2's own Finding #1 risk: if the backend's keep-alive is an SSE comment
(`: heartbeat`) instead of a named event, neither `onmessage` nor the named listener
fires, the watchdog falsely trips, and the connection reconnect-loops while perfectly
healthy.

LD's transports instead enforce a **read-timeout** (`readTimeoutMillis`, 5 min in
`StreamingProcessor.start()`): the timer is reset by **any** bytes on the connection —
named events, data, *or* comments — and fires only on true silence. This is backend-
agnostic: it adapts to the heartbeat the backend already emits, in any SSE shape, with no
new event type.

Apply within V2's design:
- **Node / React Native:** if the chosen `eventsource` / `react-native-sse` package exposes
  a read-timeout, use it (LD's node `launchdarkly-eventsource` does).
- **Browser:** native `EventSource` has no read-timeout, so keep the app-level watchdog
  there — but reset it on *any* event the connection delivers, not just a named
  `heartbeat`, so it tolerates whatever the backend currently sends.

### S7 — Borrow LD's "event after stop" guard semantics (Low)
V2 has `running`, but make sure every async `applyEvaluationsResponse` and any pending
fallback poll checks it *after* awaiting, exactly like LD's `if (this._stopped) return`
re-checks after the `await`. Prevents a stale stream from writing flags for a
torn-down/replaced user.

---

## Part 4 — One-screen summary

LaunchDarkly puts **reconnection (backoff+jitter), read-timeout, and error
classification inside a per-platform transport**, exposes a clean **processor/transport**
seam, and treats **streaming↔polling fallback as bidirectional and time-boxed** via an
orchestrator with explicit connection modes and capability flags. Its browser client SDK
streams the **full payload inline** (`put`/`patch`/`delete`) and authenticates with a
**non-secret client-side ID in the URL** — it does not poke, and it does not keep a secret
out of the URL.

The Bucketeer V2 plan gets the **opt-in, injected-EventSource, named-events, reuse-the-apply-path,
per-platform-auth** fundamentals right and is appropriately lighter than LD's full data
system. Its main gaps versus LD are: **no backoff/jitter**, **one-way permanent polling
fallback**, **no error classification** (can't tell a forbidden key from a transient drop),
a **god-object `StreamingTask`**, **brittle `=== globalThis.EventSource` sniffing**, and an
**idle-detection watchdog coupled to a specific heartbeat shape** (named event only).

All suggestions are **client-side only** and stay within V2's design — none asks the
backend to change or to add an event type. The highest-leverage borrows are
**S1 (backoff+jitter)**, **S2 (recoverable fallback)**, **S3 (error classification)**, and
**S6 (read-timeout idle detection that resets on any bytes, working with the backend's
existing keep-alive)**.

> On security finding #8: there is no client-only way to keep the `apiKey` out of the
> browser URL, because native `EventSource` cannot set headers and the backend is fixed.
> The realistic mitigations remain the ones already in V2 — a short-lived / streaming-
> scoped credential, or cookie-based auth if the backend ever supports it. (For contrast,
> LD avoids the problem by using a credential that is public by design; Bucketeer's
> `apiKey` is not.)

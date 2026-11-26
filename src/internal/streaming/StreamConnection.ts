import { Backoff } from './Backoff'
import {
  EventSourceErrorLike,
  EventSourceInstance,
  EventSourceLike,
  EventSourceLikeInit,
  MessageEventLike,
} from './EventSourceLike'
import { isRecoverableStatus, isTerminalStatus } from './httpStatus'

// Must be > the backend heartbeat interval so a healthy stream never false-trips.
const WATCHDOG_TIMEOUT_MILLIS = 70_000
// Max time with no working stream (no markWorking() since the first failure)
// before giving up and letting the caller fall back to polling. Applies
// whether or not the stream ever opened.
export const UNHEALTHY_FALLBACK_TIMEOUT_MILLIS = 120_000
// A connection open this long counts as proven-stable: forgive prior failures so
// the next drop backs off from scratch instead of continuing to escalate.
const RESET_INTERVAL_MILLIS = 60_000

export interface StreamConnectionErrorInfo {
  // true → retrying can never succeed (auth failure, streaming unsupported);
  // the caller must not schedule streaming recovery.
  terminal: boolean
}

// Says which failure happened. Raw facts only: turning them into an error for
// the app is the caller's job.
export type StreamAttemptFailure =
  | { kind: 'httpStatus'; status: number }
  | { kind: 'network'; cause: Error }
  | { kind: 'timeout'; timeoutMillis: number }
  | { kind: 'unsupported' }
  | { kind: 'setupFailed'; cause: unknown }
  | { kind: 'gaveUp' }

export interface StreamConnectionCallbacks {
  onOpen: () => void
  // Called only when this connection gives up: terminal error, non-recoverable
  // status, or unhealthy for > UNHEALTHY_FALLBACK_TIMEOUT_MILLIS.
  // Brief transient drops self-heal internally and do NOT call this.
  onError: (info: StreamConnectionErrorInfo) => void
  // Every failed attempt, also the ones retried here. Not called for a normal
  // end of the stream, or for an error with no details.
  onAttemptFailed: (failure: StreamAttemptFailure) => void
  // Bytes arrived: data or a heartbeat.
  onAlive: () => void
}

export interface StreamConnectionOptions {
  eventSource: EventSourceLike
  // Re-invoked on every (re)connect so reconnect() picks up fresh URL/headers/body.
  requestBuilder: () => { url: string; init?: EventSourceLikeInit }
  // Named backend events only (e.g. 'put', 'patch', 'error'), wired via
  // addEventListener. A 'message' key is ignored — that channel is owned by
  // this class (see openConnection()). A named event proves liveness only
  // when it carries data.
  events: Record<string, (data: string) => void>
  // Optional: receives data that matched no named handler above — a genuinely
  // unnamed SSE event ('message' is the SSE standard's default event type for
  // a block with no `event:` line — see EventSourceLike.ts) or, with the
  // built-in FetchEventSource, a named event nobody registered. Liveness
  // tracking on the message channel does NOT depend on this being provided.
  onUnhandledMessage?: (data: string) => void
  callbacks: StreamConnectionCallbacks
}

// The stream is healthy only when it is both alive and working:
//
//   alive   = bytes are arriving (any chunk, a heartbeat, an event with
//             data). markAlive() feeds the watchdog (a connection with no
//             bytes for WATCHDOG_TIMEOUT_MILLIS is retried) and calls
//             onAlive.
//   working = the stream delivers valid evaluations. Only the caller can tell
//             (it checks the payload), so it calls markWorking(). Only that
//             clears the give-up window: with no markWorking() for
//             UNHEALTHY_FALLBACK_TIMEOUT_MILLIS after the first failure,
//             this class gives up (onError) and the caller falls back to
//             polling.
//
// Alive never implies working. The server sends an `error` event as bytes
// right before it ends the stream, so a connection can be alive and still
// fail every time. In the names and comments below, "unhealthy" means "not
// working".
export class StreamConnection {
  private es: EventSourceInstance | null = null
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private backoffResetTimer: ReturnType<typeof setTimeout> | undefined
  private readonly backoff = new Backoff()
  private notWorkingSince = 0 // 0 = the stream works
  // true once a failure is reported in the current unhealthy period. A give-up
  // then adds no report, so the real error is kept.
  private failureReportedSinceWorking = false
  private active = false

  constructor(private readonly options: StreamConnectionOptions) {}

  start(): void {
    this.active = true
    this.openConnection()
  }

  // External reconnect (e.g. attribute change) — fresh request, reset backoff.
  // Deliberately does NOT clear notWorkingSince: an already-unhealthy connection
  // must keep its UNHEALTHY_FALLBACK_TIMEOUT_MILLIS give-up deadline, or an app
  // calling updateUserAttributes() more often than that window would postpone
  // the polling fallback forever while the stream endpoint stays down. A
  // healthy connection already has notWorkingSince === 0, and markWorking()
  // clears it when the stream delivers evaluations, so this only affects the
  // unhealthy case.
  reconnect(): void {
    if (!this.active) return
    this.backoff.reset()
    this.openConnection()
  }

  stop(): void {
    this.active = false
    this.clearReconnectTimer()
    this.closeEventSource()
  }

  // private

  private openConnection(): void {
    // Single-connection invariant: kill any pending retry and any live
    // EventSource before opening a new one (an external reconnect() racing a
    // scheduled backoff retry must not produce two streams).
    this.clearReconnectTimer()
    this.closeEventSource()

    let es: EventSourceInstance
    try {
      const { url, init } = this.options.requestBuilder()
      es = new this.options.eventSource(url, init)
    } catch (cause) {
      // requestBuilder() or the eventSource constructor threw synchronously
      // (e.g. a misbehaving injected EventSourceLike). openConnection() runs
      // from a setTimeout callback (backoff/watchdog/recovery) as well as
      // from start()/reconnect() — an uncaught throw there would crash a
      // Node process. Same give-up path as a runtime onerror: caller decides
      // (StreamingTask starts the polling fallback + schedules recovery).
      this.closeEventSource()
      this.reportAttemptFailed({ kind: 'setupFailed', cause })
      this.options.callbacks.onError({ terminal: false })
      return
    }
    this.es = es

    es.onopen = () => {
      if (this.es !== es) return // stale instance — already replaced
      this.armBackoffReset()
      this.resetWatchdog()
      this.options.callbacks.onOpen()
    }

    // Every handler below only marks the connection alive (see "alive" and
    // "working" above the class). Whether the stream works is told by the
    // caller through markWorking().

    // 'message' is not a name the backend chooses: it is the SSE/EventSource
    // web standard's reserved event type for a block with no `event:` line
    // (see EventSourceLike.ts). It is wired here UNCONDITIONALLY, not gated
    // behind the caller supplying onUnhandledMessage, because
    // FetchEventSource's per-chunk liveness tick always fires through
    // onmessage, with or without data, even for a chunk containing nothing
    // but the backend's heartbeat comment. That tick proves the connection
    // is delivering bytes, so it always feeds the watchdog.
    es.onmessage = (ev) => {
      if (this.es !== es) return // stale instance — already replaced
      this.markAlive()
      if (ev?.data !== undefined) this.options.onUnhandledMessage?.(ev.data)
    }

    // Wire every caller-named event (e.g. 'put', 'patch', 'error'), never
    // 'message', which is reserved for the channel above:
    //
    //   named event WITH data    → bytes arrived: feed the watchdog, deliver
    //     to the handler. Needed for an injected native EventSource, which
    //     sends no per-chunk tick.
    //   named event with NO data → ignored
    //     (e.g. a native EventSource's connection-error 'error' event carries
    //      no data: a failure signal, not bytes from the server)
    Object.entries(this.options.events).forEach(([name, handler]) => {
      if (name === 'message') return // reserved for the channel above
      const wrapped = (ev: MessageEventLike) => {
        if (this.es !== es) return // stale instance — already replaced
        if (ev?.data !== undefined) {
          this.markAlive()
          handler(ev.data)
        }
      }
      es.addEventListener(name, wrapped)
    })

    es.onerror = (ev) => {
      if (this.es !== es) return // stale instance — already replaced
      const info = (ev ?? {}) as EventSourceErrorLike
      // Reported first, before the retry or give-up decision below, so the
      // caller sees the failure before any onError.
      const failure = this.toAttemptFailure(ev, info)
      if (failure) this.reportAttemptFailed(failure)
      if (info.terminal === true || isTerminalStatus(info.status)) {
        this.closeEventSource()
        this.options.callbacks.onError({ terminal: true })
        return
      }
      if (isRecoverableStatus(info.status)) {
        // Self-heal with backoff, bounded by the unhealthy window — whether or
        // not the stream ever opened (UNHEALTHY_FALLBACK_TIMEOUT_MILLIS's
        // "applies whether or not the stream ever opened" comment above).
        this.scheduleReconnect()
        return
      }
      // A non-recoverable status → give up; caller decides.
      this.closeEventSource()
      this.options.callbacks.onError({ terminal: false })
    }

    // Also acts as the connect timeout: if the request hangs without opening,
    // the watchdog trips and scheduleReconnect() bounds the retries.
    this.resetWatchdog()
  }

  private scheduleReconnect(): void {
    this.closeEventSource()
    if (!this.active) return
    const now = Date.now()
    if (this.notWorkingSince === 0) {
      this.notWorkingSince = now
    }
    if (now - this.notWorkingSince > UNHEALTHY_FALLBACK_TIMEOUT_MILLIS) {
      // Report only if nothing was reported in this unhealthy period, so the
      // give-up does not replace a real error with one that has no details.
      if (!this.failureReportedSinceWorking) {
        this.reportAttemptFailed({ kind: 'gaveUp' })
      }
      this.options.callbacks.onError({ terminal: false })
      return
    }
    this.clearReconnectTimer()
    const delay = this.backoff.nextDelayMillis()
    this.reconnectTimer = setTimeout(() => this.openConnection(), delay)
  }

  // The caller got valid evaluations from this stream: the stream works, so
  // the give-up window is cleared, and a new unhealthy period starts with no
  // failure reported. Heartbeats after that need not clear it again: it
  // stays 0 until a connection ends.
  // The caller decides when the stream works, but the window it clears is
  // stored and checked here, because only this class sees every connection
  // end.
  markWorking(): void {
    this.notWorkingSince = 0
    this.failureReportedSinceWorking = false
  }

  // Bytes arrived: the connection is alive. Feeds the watchdog and tells the
  // caller (onAlive). Does not touch the give-up window.
  private markAlive(): void {
    this.resetWatchdog()
    // Runs on every chunk, so stream heartbeats keep lastSyncedAt current.
    this.options.callbacks.onAlive()
  }

  // null for an error with no details: a normal end of the stream ("{}" from
  // FetchEventSource) or a native EventSource Event. If the reconnect then
  // fails, that failure is reported, or the give-up reports gaveUp.
  private toAttemptFailure(
    ev: unknown,
    info: EventSourceErrorLike,
  ): StreamAttemptFailure | null {
    if (info.status !== undefined) {
      return { kind: 'httpStatus', status: info.status }
    }
    if (info.terminal === true) return { kind: 'unsupported' }
    if (ev instanceof Error) return { kind: 'network', cause: ev }
    return null
  }

  private reportAttemptFailed(failure: StreamAttemptFailure): void {
    this.failureReportedSinceWorking = true
    this.options.callbacks.onAttemptFailed(failure)
  }

  // Connection has been open — schedule forgiving prior failures once it's
  // stayed stable for RESET_INTERVAL_MILLIS. closeEventSource() cancels this if
  // the connection drops before then, so flapping connections keep escalating.
  private armBackoffReset(): void {
    clearTimeout(this.backoffResetTimer)
    this.backoffResetTimer = setTimeout(() => {
      this.backoff.reset()
    }, RESET_INTERVAL_MILLIS)
  }

  private resetWatchdog(): void {
    this.cancelWatchdog()
    this.watchdog = setTimeout(() => {
      this.reportAttemptFailed({
        kind: 'timeout',
        timeoutMillis: WATCHDOG_TIMEOUT_MILLIS,
      })
      this.scheduleReconnect()
    }, WATCHDOG_TIMEOUT_MILLIS)
  }

  private cancelWatchdog(): void {
    clearTimeout(this.watchdog)
    this.watchdog = undefined
  }

  private clearReconnectTimer(): void {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private closeEventSource(): void {
    this.cancelWatchdog()
    clearTimeout(this.backoffResetTimer)
    this.backoffResetTimer = undefined
    this.es?.close()
    this.es = null
  }
}

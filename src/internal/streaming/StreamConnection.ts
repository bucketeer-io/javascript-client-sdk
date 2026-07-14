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
// Max duration of an unhealthy period before giving up and letting the caller
// fall back to polling. Applies whether or not the stream ever opened.
const UNHEALTHY_FALLBACK_TIMEOUT_MILLIS = 120_000
// A connection open this long counts as proven-stable: forgive prior failures so
// the next drop backs off from scratch instead of continuing to escalate.
const RESET_INTERVAL_MILLIS = 60_000

export interface StreamConnectionErrorInfo {
  // true → retrying can never succeed (auth failure, streaming unsupported);
  // the caller must not schedule streaming recovery.
  terminal: boolean
}

export interface StreamConnectionCallbacks {
  onOpen: () => void
  // Called only when this connection gives up: terminal error, non-recoverable
  // status, or unhealthy for > UNHEALTHY_FALLBACK_TIMEOUT_MILLIS.
  // Brief transient drops self-heal internally and do NOT call this.
  onError: (info: StreamConnectionErrorInfo) => void
}

export interface StreamConnectionOptions {
  eventSource: EventSourceLike
  // Re-invoked on every (re)connect so reconnect() picks up fresh URL/headers/body.
  requestBuilder: () => { url: string; init?: EventSourceLikeInit }
  // Caller names the events. 'message' maps to es.onmessage; others to
  // addEventListener. Every received event resets the watchdog and marks the
  // stream healthy.
  events: Record<string, (data: string) => void>
  callbacks: StreamConnectionCallbacks
}

export class StreamConnection {
  private es: EventSourceInstance | null = null
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private backoffResetTimer: ReturnType<typeof setTimeout> | undefined
  private readonly backoff = new Backoff()
  private openedOnce = false
  private unhealthySince = 0 // 0 = healthy
  private active = false

  constructor(private readonly options: StreamConnectionOptions) {}

  start(): void {
    this.active = true
    this.openConnection()
  }

  // External reconnect (e.g. attribute change) — fresh request, reset backoff.
  reconnect(): void {
    if (!this.active) return
    this.backoff.reset()
    this.unhealthySince = 0
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

    const { url, init } = this.options.requestBuilder()
    const es = new this.options.eventSource(url, init)
    this.es = es

    es.onopen = () => {
      if (this.es !== es) return // stale instance — already replaced
      this.openedOnce = true
      this.armBackoffReset()
      this.resetWatchdog()
      this.options.callbacks.onOpen()
    }

    // Wire every caller-named event. Whether it counts as proof of liveness
    // depends on what it is:
    //
    //                 Event arrives
    //                       │
    //         ┌─────────────┴─────────────┐
    //         │ is it 'message'?          │
    //        yes                          no (a named event, e.g. 'put'/'error')
    //         │                            │
    //         ▼                     ┌──────┴──────┐
    //   mark HEALTHY           does it have data?
    //   (the built-in                │         │
    //   transport's per-           yes         no
    //   chunk tick has no            │         │
    //   data but still               ▼         ▼
    //   proves bytes are      mark HEALTHY  do NOT mark healthy
    //   arriving)             + deliver     (e.g. a standards EventSource's
    //                         the data      connection-error event — that's
    //                                       a failure signal, not proof the
    //                                       stream is working)
    Object.entries(this.options.events).forEach(([name, handler]) => {
      const wrapped = (ev: MessageEventLike) => {
        if (this.es !== es) return // stale instance — already replaced
        if (name === 'message' || ev?.data !== undefined) this.markHealthy()
        if (ev?.data !== undefined) handler(ev.data)
      }
      if (name === 'message') {
        es.onmessage = wrapped
      } else {
        es.addEventListener(name, wrapped)
      }
    })

    es.onerror = (ev) => {
      if (this.es !== es) return // stale instance — already replaced
      const info = (ev ?? {}) as EventSourceErrorLike
      if (info.terminal === true || isTerminalStatus(info.status)) {
        this.closeEventSource()
        this.options.callbacks.onError({ terminal: true })
        return
      }
      if (this.openedOnce && isRecoverableStatus(info.status)) {
        // Transient drop → self-heal with backoff, bounded by the unhealthy window.
        this.scheduleReconnect()
        return
      }
      // Never opened, or a non-recoverable status → give up; caller decides.
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
    if (this.unhealthySince === 0) {
      this.unhealthySince = now
    }
    if (now - this.unhealthySince > UNHEALTHY_FALLBACK_TIMEOUT_MILLIS) {
      this.options.callbacks.onError({ terminal: false })
      return
    }
    this.clearReconnectTimer()
    const delay = this.backoff.nextDelayMillis()
    this.reconnectTimer = setTimeout(() => this.openConnection(), delay)
  }

  // Any received event proves the stream is delivering data.
  private markHealthy(): void {
    this.unhealthySince = 0
    this.resetWatchdog()
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

import { Backoff } from './Backoff'
import {
  EventSourceInstance,
  EventSourceLike,
  EventSourceLikeInit,
  MessageEventLike,
} from './EventSourceLike'
import { isRecoverableStatus } from './httpStatus'

// Must be > the backend heartbeat interval so a healthy stream never false-trips.
const WATCHDOG_TIMEOUT_MILLIS = 70_000
// If a stream that HAS opened stays unhealthy this long, stop self-healing and let
// the caller fall back to polling. Its recovery timer retries streaming later (S2).
const OPEN_FALLBACK_TIMEOUT_MILLIS = 120_000
// A connection open this long counts as proven-stable: forgive prior failures so the
// next drop backs off from scratch instead of continuing to escalate.
const RESET_INTERVAL_MILLIS = 60_000

export interface StreamConnectionCallbacks {
  onOpen: () => void
  // Called when this connection gives up: never opened, a non-recoverable status,
  // OR opened but stayed unhealthy past OPEN_FALLBACK_TIMEOUT_MILLIS.
  // Brief transient drops self-heal here and do NOT call this.
  onError: () => void
}

export interface StreamConnectionOptions {
  eventSource: EventSourceLike
  // Re-invoked on every (re)connect so reconnect() picks up fresh URL/headers/body.
  requestBuilder: () => { url: string; init?: EventSourceLikeInit }
  // Caller names the events. 'message' maps to es.onmessage; others to addEventListener.
  // Every received event resets the watchdog (S6).
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
  private lastOpenAt = 0
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
    this.closeEventSource()
    this.openConnection()
  }

  stop(): void {
    this.active = false
    this.cancelWatchdog()
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.closeEventSource()
  }

  // private

  private openConnection(): void {
    const { url, init } = this.options.requestBuilder()
    const es = new this.options.eventSource(url, init)
    this.es = es

    es.onopen = () => {
      this.openedOnce = true
      this.lastOpenAt = Date.now()
      this.armBackoffReset()
      this.resetWatchdog()
      this.options.callbacks.onOpen()
    }

    // Wire every caller-named event; each resets the watchdog (S6).
    Object.entries(this.options.events).forEach(([name, handler]) => {
      const wrapped = (ev: MessageEventLike) => {
        this.resetWatchdog()
        if (ev?.data !== undefined) handler(ev.data)
      }
      if (name === 'message') {
        es.onmessage = wrapped
      } else {
        es.addEventListener(name, wrapped)
      }
    })

    es.onerror = (ev) => {
      const status = (ev as { status?: number } | null)?.status
      const recoverable = isRecoverableStatus(status)
      if (this.openedOnce && recoverable) {
        // Transient drop after a healthy connection → self-heal with backoff (S1).
        this.scheduleReconnect()
        return
      }
      // Never opened OR non-recoverable status → give up; let caller decide fallback.
      this.closeEventSource()
      this.options.callbacks.onError()
    }

    this.resetWatchdog()
  }

  private scheduleReconnect(): void {
    this.closeEventSource()
    if (!this.active) return
    // If the stream opened but has stayed unhealthy past the fallback timeout, give
    // up and let the caller fall back to polling (Option B). The caller's recovery
    // timer periodically retries streaming (S2).
    if (
      this.openedOnce &&
      Date.now() - this.lastOpenAt > OPEN_FALLBACK_TIMEOUT_MILLIS
    ) {
      this.options.callbacks.onError()
      return
    }
    const delay = this.backoff.nextDelayMillis()
    this.reconnectTimer = setTimeout(() => this.openConnection(), delay)
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

  private closeEventSource(): void {
    this.cancelWatchdog()
    clearTimeout(this.backoffResetTimer)
    this.backoffResetTimer = undefined
    this.es?.close()
    this.es = null
  }
}

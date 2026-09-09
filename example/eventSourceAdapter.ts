// Demo-only adapter over the `eventsource-client` library. It exists to show
// how to satisfy the SDK's EventSourceLike contract with a real SSE library
// instead of the built-in FetchEventSource transport. Most apps should set
// enableStreaming: true and nothing else; this escape hatch only applies when
// a specific SSE client library is required. It is not a way to run without
// ReadableStream: eventsource-client's default entry point reads the response
// through a web ReadableStream too, and rejects any other body type.
import { createEventSource } from 'eventsource-client'
import type { FetchLike as ClientFetchLike } from 'eventsource-client'
import type {
  EventSourceErrorLike,
  EventSourceInstance,
  EventSourceLikeInit,
  MessageEventLike,
} from '@bucketeer/js-client-sdk'
import type { StreamReporter } from './types'

const READY_STATE_CONNECTING = 0
const READY_STATE_OPEN = 1
const READY_STATE_CLOSED = 2

export class EventSourceAdapter implements EventSourceInstance {
  readyState: number = READY_STATE_CONNECTING
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: MessageEventLike) => void) | null = null
  onerror: ((ev: EventSourceErrorLike | unknown) => void) | null = null

  private readonly listeners = new Map<
    string,
    Array<(ev: MessageEventLike) => void>
  >()
  // 5. StreamConnection closes and replaces instances freely. Once set, every
  // callback below returns early so a dying instance cannot fire onerror (or
  // report()) into the SDK/UI after being discarded.
  private closed = false
  // 3. eventsource-client's own callbacks carry no HTTP status, but the SDK's
  // terminal-vs-recoverable classification needs one (see
  // src/internal/streaming/httpStatus.ts). The status-capturing fetch below
  // records the status of the failed request here; onDisconnect reads it.
  private lastErrorStatus: number | undefined
  // Set when the failure can never succeed on retry, so handleDisconnect can
  // pass EventSourceErrorLike.terminal and StreamConnection stops retrying
  // instead of reconnecting for the client's lifetime.
  private lastErrorTerminal = false
  private readonly client: ReturnType<typeof createEventSource>

  constructor(
    url: string,
    init: EventSourceLikeInit | undefined,
    private readonly report: StreamReporter,
  ) {
    this.report({
      kind: 'request',
      path: '/stream_evaluations',
      method: init?.method ?? 'POST',
    })

    // 3. Recover the HTTP status and treat a non-2xx response as a failed
    // connection. eventsource-client calls onConnect for any response that
    // resolves, 2xx or not, so a 401/403 would otherwise report a false
    // "open" state; throwing here routes it through the library's
    // fetch-rejection path (handled by onScheduleReconnect below) instead.
    const statusCapturingFetch: ClientFetchLike = async (
      fetchUrl,
      fetchInit,
    ) => {
      const response = await fetch(fetchUrl, fetchInit)
      if (!response.ok) {
        this.lastErrorStatus = response.status
        throw new Error(`stream_evaluations responded with ${response.status}`)
      }
      // A 2xx response whose body cannot be read as a stream never becomes
      // readable on a retry either, so it is terminal rather than
      // recoverable. The built-in transport classifies the same response the
      // same way (see FetchEventSource.ts:99-107).
      if (!response.body || typeof response.body.getReader !== 'function') {
        this.lastErrorTerminal = true
        throw new Error('stream_evaluations responded without a readable body')
      }
      this.lastErrorStatus = undefined
      this.lastErrorTerminal = false
      return response
    }

    this.client = createEventSource({
      url,
      method: init?.method,
      // 7. init.headers already carries Authorization, Content-Type and
      // Accept — pass it through unchanged.
      headers: init?.headers,
      body: init?.body ?? undefined,
      fetch: statusCapturingFetch,
      onConnect: () => {
        if (this.closed) return
        this.readyState = READY_STATE_OPEN
        this.onopen?.({})
        this.report({ kind: 'open' })
      },
      // 1. Heartbeat liveness. The backend heartbeats with SSE comment lines
      // every 25s and the SDK watchdog fires at 70s
      // (StreamConnection.ts:11-12). onComment must produce a bare
      // onmessage({ data: undefined }) tick, or a quiet stream is torn down
      // and reopened every ~70 seconds.
      onComment: () => {
        if (this.closed) return
        this.onmessage?.({ data: undefined })
        this.report({ kind: 'heartbeat' })
      },
      onMessage: (message) => {
        if (this.closed) return
        this.dispatch(message)
      },
      // 2. Turn off the library's own reconnection. StreamConnection already
      // owns backoff, the watchdog and the polling fallback, so close() is
      // called here *before* reporting onerror, leaving all retry timing to
      // the SDK.
      onDisconnect: () => {
        this.handleDisconnect()
      },
      // eventsource-client calls this instead of onDisconnect whenever the
      // fetch itself rejects (network error, or the status rejection above)
      // or the response has no body: onDisconnect is never called on those
      // paths in eventsource-client@1.2.0. Treat it the same way so the SDK
      // still learns the stream closed and its own backoff/polling fallback
      // takes over, instead of a silent retry loop the SDK never hears
      // about. On an ordinary end-of-stream this also fires together with
      // onDisconnect, back to back; the `closed` guard in handleDisconnect
      // makes the second call a no-op.
      onScheduleReconnect: () => {
        this.handleDisconnect()
      },
    })
  }

  addEventListener(
    type: string,
    listener: (ev: MessageEventLike) => void,
  ): void {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type)!.push(listener)
  }

  removeEventListener(
    type: string,
    listener: (ev: MessageEventLike) => void,
  ): void {
    const arr = this.listeners.get(type)
    if (!arr) return
    const i = arr.indexOf(listener)
    if (i !== -1) arr.splice(i, 1)
  }

  close(): void {
    this.closed = true
    this.readyState = READY_STATE_CLOSED
    this.client.close()
  }

  // Shared by onDisconnect and onScheduleReconnect above. Stops the
  // library's own retry loop and reports the closure once; the `closed`
  // guard makes a repeat call a no-op.
  private handleDisconnect(): void {
    if (this.closed) return
    this.closed = true
    this.client.close()
    this.readyState = READY_STATE_CLOSED
    const status = this.lastErrorStatus
    const terminal = this.lastErrorTerminal
    this.lastErrorStatus = undefined
    this.lastErrorTerminal = false
    this.onerror?.({ status, terminal })
    this.report({ kind: 'closed', status, terminal })
  }

  // 4. Event routing. StreamingTask registers exactly three named handlers
  // (put, patch, error): dispatch to them by name. 'message' is the SSE
  // standard's default event type, covering both a block with no `event:`
  // line and an explicit `event: message`; StreamConnection never registers
  // a listener under that name (it owns the onmessage channel itself), so
  // both forms go to onmessage, same as the built-in transport. A *named*
  // event with no registered handler is dropped and must never fall through
  // to onmessage.
  private dispatch(message: { event?: string; data: string }): void {
    // eventsource-parser already reports an absent or empty `event:` value as
    // undefined, so this covers the empty case the SSE spec maps to the
    // default type too.
    const eventName = message.event ?? 'message'
    if (message.event) {
      this.report({
        kind: 'sse',
        name: message.event,
        chars: message.data.length,
      })
    }
    const handlers = this.listeners.get(eventName)
    if (handlers && handlers.length > 0) {
      handlers.forEach((handler) => handler({ data: message.data }))
    } else if (eventName === 'message') {
      this.onmessage?.({ data: message.data })
    }
  }
}

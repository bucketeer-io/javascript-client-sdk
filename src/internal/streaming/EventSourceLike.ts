// Injectable transport contract for SSE streaming.
//
// Injection note: the SDK's watchdog treats *any* received event as proof of
// liveness. The built-in FetchEventSource additionally emits a bare
// onmessage({ data: undefined }) tick for every received chunk, so even SSE
// comment heartbeats (": ping") keep the stream alive. Native-style EventSource
// implementations do NOT surface comment lines — if you inject one and the
// backend heartbeats with comments only, the watchdog will false-trip. Injected
// implementations should either emit named/unnamed events for heartbeats or
// provide their own liveness signalling. The init.headers an injected
// implementation receives already carry the complete request profile
// (Authorization, Content-Type: application/json, Accept: text/event-stream) —
// it should send them as-is and must not depend on the SDK's built-in transport
// to add anything.
export interface EventSourceLike {
  new (url: string, init?: EventSourceLikeInit): EventSourceInstance
}

export interface EventSourceLikeInit {
  method?: string
  headers?: Record<string, string>
  body?: string | null
}

export interface EventSourceErrorLike {
  status?: number // HTTP status when known
  terminal?: boolean // true = retrying can never succeed (e.g. streaming unsupported)
}

export interface EventSourceInstance {
  readonly readyState: number
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: MessageEventLike) => void) | null
  onerror: ((ev: EventSourceErrorLike | unknown) => void) | null
  addEventListener(type: string, listener: (ev: MessageEventLike) => void): void
  removeEventListener(type: string, listener: (ev: MessageEventLike) => void): void
  close(): void
}

export interface MessageEventLike {
  data?: string
}

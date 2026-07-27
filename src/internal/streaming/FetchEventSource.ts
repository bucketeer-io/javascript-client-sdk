import { FetchLike } from '../remote/fetch'
import {
  EventSourceInstance,
  EventSourceLikeInit,
  MessageEventLike,
} from './EventSourceLike'

const READY_STATE_CONNECTING = 0
const READY_STATE_OPEN = 1
const READY_STATE_CLOSED = 2

// SSE lines may end with \r\n, \n, or \r (WHATWG spec). Normalize to \n so the
// parser only deals with one framing. Idempotent on already-normalized text.
const normalizeLineEndings = (text: string): string =>
  text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

export class FetchEventSource implements EventSourceInstance {
  readyState: number = READY_STATE_CONNECTING
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: MessageEventLike) => void) | null = null
  onerror: ((ev: { status?: number; terminal?: boolean } | unknown) => void) | null =
    null

  private readonly listeners = new Map<
    string,
    Array<(ev: MessageEventLike) => void>
  >()
  private abortController: AbortController | null = null

  constructor(
    private readonly url: string,
    private readonly init: EventSourceLikeInit = {},
    private readonly fetchImpl: FetchLike,
  ) {
    this.connect()
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
    this.readyState = READY_STATE_CLOSED
    this.abortController?.abort()
    this.abortController = null
  }

  // private

  private connect(): void {
    if (this.readyState === READY_STATE_CLOSED) return
    const ac = new AbortController()
    this.abortController = ac

    // Object.assign, not spread: caller headers (e.g. Authorization) must win
    // over the defaults, and the no-spread-after-defaults lint rule forbids
    // writing that as a spread after default properties.
    const headers = Object.assign(
      {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      this.init.headers,
    )

    // Call the injected fetch receiver-free: `this.fetchImpl(...)` would pass
    // this FetchEventSource instance as `this`, and the default unbound
    // `globalThis.fetch` brand-checks its receiver in browsers ("Illegal
    // invocation"). A bare call leaves `this` undefined → global fallback.
    const doFetch = this.fetchImpl
    doFetch(this.url, {
      method: this.init.method ?? 'POST',
      headers,
      body: this.init.body ?? '',
      signal: ac.signal,
    })
      .then((response) => {
        if (this.readyState === READY_STATE_CLOSED) return
        if (!response.ok) {
          this.readyState = READY_STATE_CLOSED
          this.onerror?.({ status: response.status })
          return
        }
        if (!response.body || typeof response.body.getReader !== 'function') {
          // No WHATWG ReadableStream: the runtime's fetch cannot stream (e.g.
          // React Native without a polyfill), or an injected fetch returns a
          // non-WHATWG body (e.g. node-fetch → Node.js Readable, no
          // getReader()). Retrying can never succeed with this fetch
          // implementation → terminal.
          this.readyState = READY_STATE_CLOSED
          this.onerror?.({ terminal: true })
          return
        }
        this.readyState = READY_STATE_OPEN
        this.onopen?.({})
        return this.readStream(response.body)
      })
      .then(() => {
        // Stream ended naturally (server closed) — signal a recoverable error
        // so StreamConnection can decide whether to reconnect.
        if (this.readyState !== READY_STATE_CLOSED) {
          this.readyState = READY_STATE_CLOSED
          this.onerror?.({})
        }
      })
      .catch((err: unknown) => {
        if (this.readyState === READY_STATE_CLOSED) return
        if (err instanceof Error && err.name === 'AbortError') return
        this.readyState = READY_STATE_CLOSED
        this.onerror?.(err)
      })
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (this.readyState === READY_STATE_OPEN) {
        const { done, value } = await reader.read()
        if (done) {
          // End of stream: flush the decoder (the stream may end mid
          // multi-byte character). The output is deliberately discarded — it
          // can only belong to an unterminated block, and SSE dispatches
          // events only on a blank-line terminator, so nothing parseable is
          // ever lost here.
          decoder.decode()
          break
        }
        // Liveness tick: fire a bare onmessage on every chunk so the caller's
        // watchdog resets on any received bytes, including SSE comment
        // heartbeats (": ping"). The tick carries no data. NOTE: StreamConnection
        // wires es.onmessage unconditionally (see its openConnection()), so this
        // tick always reaches it regardless of what the caller registered.
        this.onmessage?.({ data: undefined })
        buffer += decoder.decode(value, { stream: true })
        // A trailing \r may be half of a \r\n split across chunks — hold it
        // back so normalization can't turn one CRLF into two newlines.
        let pendingCR = ''
        if (buffer.endsWith('\r')) {
          pendingCR = '\r'
          buffer = buffer.slice(0, -1)
        }
        buffer = this.parseBuffer(normalizeLineEndings(buffer)) + pendingCR
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        // cancel() rejects if the stream already errored — nothing to clean up
      }
    }
  }

  // Parses complete SSE events from the (LF-normalized) buffer.
  // Returns the unconsumed remainder.
  private parseBuffer(buffer: string): string {
    const blocks = buffer.split(/\n\n/)
    const remainder = blocks.pop() ?? ''
    for (const block of blocks) {
      if (!block.trim()) continue
      // 'message' is not a name the backend chooses — it's the SSE/EventSource
      // web standard's reserved default event type for a block with no
      // `event:` line (WHATWG HTML spec, "Server-sent events"). A native
      // browser EventSource dispatches such blocks via `.onmessage` /
      // `addEventListener('message', ...)`; this mirrors that rule.
      let eventName = 'message'
      let hasEventLine = false
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        } else if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
          hasEventLine = true
        }
        // Comment lines (':') count as liveness via the per-chunk tick above
      }
      if (dataLines.length === 0) continue
      const ev: MessageEventLike = { data: dataLines.join('\n') }
      const handlers = this.listeners.get(eventName)
      if (handlers && handlers.length > 0) {
        handlers.forEach((h) => h(ev))
      } else if (!hasEventLine) {
        // Genuinely unnamed (no `event:` line) falls back to onmessage, per
        // the SSE/EventSource standard. A NAMED event with no registered
        // listener is dropped silently instead — same native EventSource
        // semantics — so an unknown event name can never be misrouted into
        // onmessage and misinterpreted as evaluation data.
        this.onmessage?.(ev)
      }
    }
    return remainder
  }
}

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
  onerror:
    | ((ev: { status?: number; terminal?: boolean } | unknown) => void)
    | null = null

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
    // Retained remainder, already normalized — never re-normalized (that was
    // the quadratic cost: every chunk re-normalizing everything received so
    // far). Only the newly-decoded chunk gets normalized before appending.
    let buffer = ''
    // A trailing \r held back from the previous chunk may be half of a \r\n
    // split across the chunk boundary — prepended to the next chunk's raw
    // text before normalizing it (see the CRLF-split test).
    let pendingCR = ''
    // Resume point for the \n\n scan in parseBuffer(): the portion of buffer
    // before this offset has already been searched and found clean, so it's
    // never rescanned — avoids re-scanning a large, still-growing block on
    // every chunk.
    let searchOffset = 0
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
        let chunkText = pendingCR + decoder.decode(value, { stream: true })
        pendingCR = ''
        if (chunkText.endsWith('\r')) {
          pendingCR = '\r'
          chunkText = chunkText.slice(0, -1)
        }
        buffer += normalizeLineEndings(chunkText)
        const result = this.parseBuffer(buffer, searchOffset)
        buffer = result.remainder
        searchOffset = result.searchOffset
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        // cancel() rejects if the stream already errored — nothing to clean up
      }
    }
  }

  // Dispatches complete SSE events out of the (LF-normalized) buffer,
  // scanning for the '\n\n' block separator with indexOf from searchFrom
  // instead of splitting the whole buffer — the portion before searchFrom
  // already went through a previous call and contained no separator, so it
  // never needs rescanning. Returns the unconsumed remainder and the offset
  // to resume scanning from next time.
  private parseBuffer(
    buffer: string,
    searchFrom: number,
  ): { remainder: string; searchOffset: number } {
    let offset = searchFrom
    while (true) {
      const sepIndex = buffer.indexOf('\n\n', offset)
      if (sepIndex === -1) {
        // No complete block beyond what's already been scanned. Resume from
        // one char before the end next time, so a '\n\n' split across this
        // chunk and the next (one '\n' at the very end, the other at the
        // start of the next chunk) is still caught.
        return {
          remainder: buffer,
          searchOffset: Math.max(0, buffer.length - 1),
        }
      }
      this.dispatchBlock(buffer.slice(0, sepIndex))
      buffer = buffer.slice(sepIndex + 2)
      offset = 0
    }
  }

  private dispatchBlock(block: string): void {
    if (!block.trim()) return
    // 'message' is not a name the backend chooses — it's the SSE/EventSource
    // web standard's reserved default event type for a block with no
    // `event:` line (WHATWG HTML spec, "Server-sent events"). A native
    // browser EventSource dispatches such blocks via `.onmessage` /
    // `addEventListener('message', ...)`; this mirrors that rule.
    let eventName = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      } else if (line.startsWith('event:')) {
        // An empty event type buffer leaves the type as the default
        // 'message' (WHATWG), so an empty `event:` line behaves like none.
        const name = line.slice(6).trim()
        eventName = name === '' ? 'message' : name
      }
      // Comment lines (':') count as liveness via the per-chunk tick above
    }
    if (dataLines.length === 0) return
    const ev: MessageEventLike = { data: dataLines.join('\n') }
    const handlers = this.listeners.get(eventName)
    if (handlers && handlers.length > 0) {
      handlers.forEach((h) => h(ev))
    } else if (eventName === 'message') {
      // The default 'message' type — whether from no `event:` line, an empty
      // one, or an explicit `event: message` — falls back to onmessage, per
      // the SSE/EventSource standard. A NAMED event with no registered
      // listener is dropped silently instead (its name is never 'message'),
      // so an unknown event name can't be misrouted into onmessage and
      // misinterpreted as evaluation data.
      this.onmessage?.(ev)
    }
  }
}

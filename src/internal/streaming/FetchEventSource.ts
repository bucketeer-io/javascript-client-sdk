import { FetchLike } from '../remote/fetch'
import {
  EventSourceInstance,
  EventSourceLikeInit,
  MessageEventLike,
} from './EventSourceLike'

const READY_STATE_CONNECTING = 0
const READY_STATE_OPEN = 1
const READY_STATE_CLOSED = 2

export class FetchEventSource implements EventSourceInstance {
  readyState: number = READY_STATE_CONNECTING
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: MessageEventLike) => void) | null = null
  onerror: ((ev: { status?: number } | unknown) => void) | null = null

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

    this.fetchImpl(this.url, {
      method: this.init.method ?? 'POST',
      headers: {
        ...(this.init.headers ?? {}),
        'Content-Type': 'application/json',
      },
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
        if (!response.body) {
          // Null body means the runtime doesn't support ReadableStream streaming.
          this.readyState = READY_STATE_CLOSED
          this.onerror?.({})
          return
        }
        this.readyState = READY_STATE_OPEN
        this.onopen?.({})
        return this.readStream(response.body as ReadableStream<Uint8Array>)
      })
      .then(() => {
        // Stream ended naturally (server closed) — signal error so StreamConnection
        // can decide whether to reconnect.
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
        if (done) break
        // Fire a bare onmessage on every chunk so StreamConnection's watchdog
        // resets on any received bytes, including SSE comments / heartbeats (S6).
        this.onmessage?.({ data: undefined })
        buffer += decoder.decode(value, { stream: true })
        buffer = this.parseBuffer(buffer)
      }
    } finally {
      reader.cancel()
    }
  }

  // Parses complete SSE events from the buffer. Returns unconsumed remainder.
  private parseBuffer(buffer: string): string {
    const blocks = buffer.split(/\n\n/)
    const remainder = blocks.pop() ?? ''
    for (const block of blocks) {
      if (!block.trim()) continue
      let eventName = 'message'
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        } else if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        }
        // Comment lines (':') counted as liveness via the onmessage chunk tick above
      }
      if (dataLines.length === 0) continue
      const ev: MessageEventLike = { data: dataLines.join('\n') }
      const handlers = this.listeners.get(eventName)
      if (handlers && handlers.length > 0) {
        handlers.forEach((h) => h(ev))
      } else {
        this.onmessage?.(ev)
      }
    }
    return remainder
  }
}

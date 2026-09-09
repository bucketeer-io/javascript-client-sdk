import { afterEach, beforeEach, expect, suite, test, vi } from 'vitest'
import type { EventSourceErrorLike } from '../../src/internal/streaming/EventSourceLike'
import type { StreamEvent } from '../../example/types'

// The adapter's whole job is translating eventsource-client's callbacks into
// the SDK's EventSourceLike contract, so the library is replaced with a fake
// that hands the test those callbacks directly. That is what makes the
// awkward parts testable: eventsource-client@1.2.0 calls onScheduleReconnect
// (not onDisconnect) for a rejected fetch, and calls both, back to back, at
// end of stream.
interface CreatedClient {
  options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    fetch: (
      url: string | URL,
      init?: unknown,
    ) => Promise<{ status: number; body: unknown }>
    onConnect?: () => void
    onComment?: (comment: string) => void
    onMessage?: (message: { event?: string; data: string }) => void
    onDisconnect?: () => void
    onScheduleReconnect?: (info: { delay: number }) => void
  }
  closeCalls: number
}

const { created } = vi.hoisted(() => ({ created: [] as CreatedClient[] }))

vi.mock('eventsource-client', () => ({
  createEventSource: (options: CreatedClient['options']) => {
    const client: CreatedClient = { options, closeCalls: 0 }
    created.push(client)
    return {
      close: () => {
        client.closeCalls++
      },
      connect: () => undefined,
      readyState: 'connecting',
      lastEventId: undefined,
      url: options.url,
    }
  },
}))

const { EventSourceAdapter } = await import('../../example/eventSourceAdapter')

const READY_STATE_CONNECTING = 0
const READY_STATE_OPEN = 1
const READY_STATE_CLOSED = 2

const STREAM_URL = 'https://api.example.test/stream_evaluations'

// Builds an adapter plus everything needed to inspect what it reported.
function build() {
  const events: StreamEvent[] = []
  const errors: (EventSourceErrorLike | unknown)[] = []
  const messages: { data?: string }[] = []
  const adapter = new EventSourceAdapter(
    STREAM_URL,
    { method: 'POST', headers: { Authorization: 'bearer key' }, body: '{}' },
    (event) => events.push(event),
  )
  adapter.onerror = (ev) => errors.push(ev)
  adapter.onmessage = (ev) => messages.push(ev)
  const client = created[created.length - 1]
  const of = <K extends StreamEvent['kind']>(kind: K) =>
    events.filter(
      (e): e is Extract<StreamEvent, { kind: K }> => e.kind === kind,
    )
  return { adapter, client, events, errors, messages, of }
}

function response(init: {
  status: number
  body?: ReadableStream<Uint8Array> | null
}) {
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    body: init.body === undefined ? new ReadableStream() : init.body,
  }
}

beforeEach(() => {
  created.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

suite('example/eventSourceAdapter', () => {
  test('reports the request and passes the init through unchanged', () => {
    const { client, of } = build()

    expect(of('request')).toEqual([
      { kind: 'request', path: '/stream_evaluations', method: 'POST' },
    ])
    expect(client.options.url).toBe(STREAM_URL)
    expect(client.options.method).toBe('POST')
    expect(client.options.headers).toEqual({ Authorization: 'bearer key' })
    expect(client.options.body).toBe('{}')
  })

  test('onConnect opens the stream', () => {
    const { adapter, client, of } = build()
    expect(adapter.readyState).toBe(READY_STATE_CONNECTING)

    client.options.onConnect?.()

    expect(adapter.readyState).toBe(READY_STATE_OPEN)
    expect(of('open')).toHaveLength(1)
  })

  test('a comment heartbeat produces a bare liveness tick', () => {
    const { client, messages, of } = build()

    client.options.onComment?.('ping')

    // Bare tick: the SDK watchdog only needs to know bytes arrived.
    expect(messages).toEqual([{ data: undefined }])
    expect(of('heartbeat')).toHaveLength(1)
  })

  test('a non-2xx response is rejected instead of reported as open', async () => {
    const { client, errors, of } = build()
    vi.stubGlobal('fetch', () => Promise.resolve(response({ status: 401 })))

    await expect(client.options.fetch(STREAM_URL)).rejects.toThrow('401')
    // The library reaches for onScheduleReconnect, not onDisconnect, when the
    // fetch rejects.
    client.options.onScheduleReconnect?.({ delay: 2000 })

    expect(errors).toEqual([{ status: 401, terminal: false }])
    expect(of('closed')).toEqual([
      { kind: 'closed', status: 401, terminal: false },
    ])
    expect(of('open')).toHaveLength(0)
  })

  test('the closed report fires before onerror, not after', async () => {
    // onerror is what the SDK reacts to; for a non-terminal, non-fast-retry
    // status it can synchronously start the polling fallback, which reports
    // its own 'request'. If the closed report fired after onerror, it would
    // land after that and overwrite the fallback state the fallback request
    // just set.
    const order: string[] = []
    const adapter = new EventSourceAdapter(STREAM_URL, {}, (event) => {
      if (event.kind === 'closed') order.push('report:closed')
    })
    adapter.onerror = () => order.push('onerror')
    const client = created[created.length - 1]
    vi.stubGlobal('fetch', () => Promise.resolve(response({ status: 400 })))

    await expect(client.options.fetch(STREAM_URL)).rejects.toThrow('400')
    client.options.onScheduleReconnect?.({ delay: 2000 })

    expect(order).toEqual(['report:closed', 'onerror'])
  })

  test('a 2xx response with no readable body is terminal', async () => {
    const { client, errors, of } = build()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(response({ status: 200, body: null })),
    )

    await expect(client.options.fetch(STREAM_URL)).rejects.toThrow(
      'without a readable body',
    )
    client.options.onScheduleReconnect?.({ delay: 2000 })

    expect(errors).toEqual([{ status: undefined, terminal: true }])
    expect(of('closed')).toEqual([
      { kind: 'closed', status: undefined, terminal: true },
    ])
  })

  test('a body that is not a web stream is terminal too', async () => {
    const { client, errors } = build()
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, status: 200, body: { on: () => undefined } }),
    )

    await expect(client.options.fetch(STREAM_URL)).rejects.toThrow(
      'without a readable body',
    )
    client.options.onScheduleReconnect?.({ delay: 2000 })

    expect(errors).toEqual([{ status: undefined, terminal: true }])
  })

  test('a rejected fetch closes the stream and tells the SDK', async () => {
    const { adapter, client, errors, of } = build()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('dns failure')))

    await expect(client.options.fetch(STREAM_URL)).rejects.toThrow(
      'dns failure',
    )
    client.options.onScheduleReconnect?.({ delay: 2000 })

    // Recoverable, so the SDK retries on its own schedule.
    expect(errors).toEqual([{ status: undefined, terminal: false }])
    expect(of('closed')).toHaveLength(1)
    // The library's own retry loop must be stopped, or two loops race.
    expect(client.closeCalls).toBe(1)
    expect(adapter.readyState).toBe(READY_STATE_CLOSED)
  })

  test('a successful response clears the status an earlier failure recorded', async () => {
    const { client, errors, of } = build()
    vi.stubGlobal('fetch', () => Promise.resolve(response({ status: 500 })))
    await expect(client.options.fetch(STREAM_URL)).rejects.toThrow('500')

    const ok = response({ status: 200 })
    vi.stubGlobal('fetch', () => Promise.resolve(ok))
    await expect(client.options.fetch(STREAM_URL)).resolves.toBe(ok)

    client.options.onDisconnect?.()

    // The 500 from the earlier attempt must not be reported as the reason
    // this connection ended, or the SDK would treat a recoverable end of
    // stream as a server error.
    expect(errors).toEqual([{ status: undefined, terminal: false }])
    expect(of('closed')).toEqual([
      { kind: 'closed', status: undefined, terminal: false },
    ])
  })

  test('end of stream reports the closure exactly once', () => {
    const { client, errors, of } = build()
    client.options.onConnect?.()

    // At EOF the library calls both, back to back, in this order.
    client.options.onScheduleReconnect?.({ delay: 2000 })
    client.options.onDisconnect?.()

    expect(errors).toHaveLength(1)
    expect(of('closed')).toHaveLength(1)
    expect(client.closeCalls).toBe(1)
  })

  test('onDisconnect alone also reports the closure once', () => {
    const { client, errors, of } = build()
    client.options.onConnect?.()

    client.options.onDisconnect?.()
    client.options.onDisconnect?.()

    expect(errors).toHaveLength(1)
    expect(of('closed')).toHaveLength(1)
  })

  test('a discarded instance goes quiet after close()', () => {
    const { adapter, client, errors, messages, of } = build()
    client.options.onConnect?.()

    adapter.close()
    client.options.onConnect?.()
    client.options.onComment?.('ping')
    client.options.onMessage?.({ event: 'put', data: '{}' })
    client.options.onDisconnect?.()
    client.options.onScheduleReconnect?.({ delay: 2000 })

    expect(adapter.readyState).toBe(READY_STATE_CLOSED)
    expect(errors).toHaveLength(0)
    expect(messages).toHaveLength(0)
    expect(of('closed')).toHaveLength(0)
    expect(of('sse')).toHaveLength(0)
    // Only the open from before close().
    expect(of('open')).toHaveLength(1)
  })

  test('a named event reaches its registered listener', () => {
    const { adapter, client, messages, of } = build()
    const put: string[] = []
    adapter.addEventListener('put', (ev) => put.push(ev.data ?? ''))

    client.options.onMessage?.({ event: 'put', data: '{"a":1}' })

    expect(put).toEqual(['{"a":1}'])
    expect(messages).toHaveLength(0)
    expect(of('sse')).toEqual([
      { kind: 'sse', name: 'put', chars: '{"a":1}'.length },
    ])
  })

  test('a block with no event name goes to onmessage', () => {
    const { client, messages, of } = build()

    client.options.onMessage?.({ data: '{"a":1}' })

    expect(messages).toEqual([{ data: '{"a":1}' }])
    expect(of('sse')).toHaveLength(0)
  })

  test('an explicit "event: message" goes to onmessage as well', () => {
    const { client, messages } = build()

    client.options.onMessage?.({ event: 'message', data: '{"a":1}' })

    // StreamConnection never registers a 'message' listener, so routing this
    // as a named event would drop the payload.
    expect(messages).toEqual([{ data: '{"a":1}' }])
  })

  test('a named event nobody registered is dropped, not sent to onmessage', () => {
    const { client, messages } = build()

    client.options.onMessage?.({ event: 'unknown', data: '{"a":1}' })

    expect(messages).toHaveLength(0)
  })

  test('removeEventListener stops delivery', () => {
    const { adapter, client } = build()
    const seen: string[] = []
    const listener = (ev: { data?: string }) => seen.push(ev.data ?? '')
    adapter.addEventListener('patch', listener)
    adapter.removeEventListener('patch', listener)

    client.options.onMessage?.({ event: 'patch', data: '{"a":1}' })

    expect(seen).toEqual([])
  })

  test('close() stops the library client', () => {
    const { adapter, client } = build()

    adapter.close()

    expect(client.closeCalls).toBe(1)
    expect(adapter.readyState).toBe(READY_STATE_CLOSED)
  })
})

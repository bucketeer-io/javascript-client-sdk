import { expect, suite, test, vi } from 'vitest'
import { FetchEventSource } from '../../../src/internal/streaming/FetchEventSource'
import { MessageEventLike } from '../../../src/internal/streaming/EventSourceLike'
import {
  FetchLike,
  FetchRequestLike,
  FetchResponseLike,
} from '../../../src/internal/remote/fetch'

const encoder = new TextEncoder()

function streamOf(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
        )
      }
      controller.close()
    },
  })
}

function okResponse(
  body: ReadableStream<Uint8Array> | null | undefined,
): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    body,
  }
}

function fetchReturning(response: FetchResponseLike): FetchLike {
  return () => Promise.resolve(response)
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(cond()).toBe(true)
}

// Collects every callback interaction of one FetchEventSource instance.
function instrument(es: FetchEventSource) {
  const opened = vi.fn()
  const messages: MessageEventLike[] = []
  const errors: unknown[] = []
  es.onopen = opened
  es.onmessage = (ev) => messages.push(ev)
  es.onerror = (ev) => errors.push(ev)
  // Data-carrying messages only — the per-chunk liveness ticks have data: undefined.
  const dataMessages = () => messages.filter((m) => m.data !== undefined)
  const ended = () => errors.length > 0
  return { opened, messages, dataMessages, errors, ended }
}

suite('internal/streaming/FetchEventSource', () => {
  test('200 + data block: onopen fires and onmessage receives the data', async () => {
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(streamOf('data: {"a":1}\n\n'))),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.opened).toHaveBeenCalledTimes(1)
    expect(t.dataMessages()).toEqual([{ data: '{"a":1}' }])
  })

  test('named event block goes to its listener, not onmessage', async () => {
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(
        okResponse(streamOf('event: evaluations\ndata: {"b":2}\n\n')),
      ),
    )
    const t = instrument(es)
    const named: MessageEventLike[] = []
    es.addEventListener('evaluations', (ev) => named.push(ev))

    await until(t.ended)
    expect(named).toEqual([{ data: '{"b":2}' }])
    expect(t.dataMessages()).toEqual([])
  })

  test('a named event with no registered listener is dropped, not delivered to onmessage (regression: unknown named events must not be treated as unnamed)', async () => {
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(streamOf('event: ping\ndata: {"c":3}\n\n'))),
    )
    const t = instrument(es)
    // No listener registered for 'ping'.

    await until(t.ended)
    expect(t.dataMessages()).toEqual([]) // must NOT reach onmessage
  })

  test('an explicit "event: message" block reaches onmessage, matching native EventSource', async () => {
    // A native EventSource dispatches any block whose type is 'message' —
    // explicit or defaulted — through onmessage. StreamConnection never
    // registers a 'message' listener, so an explicit event: message must fall
    // back to onmessage, not be dropped like an unknown named event.
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(streamOf('event: message\ndata: {"m":1}\n\n'))),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.dataMessages()).toEqual([{ data: '{"m":1}' }])
  })

  test('an empty "event:" line falls back to the default message type and reaches onmessage', async () => {
    // Per WHATWG, an empty event type buffer leaves the type as the default
    // 'message' — so an empty event: line behaves like no event: line at all.
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(streamOf('event:\ndata: {"m":2}\n\n'))),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.dataMessages()).toEqual([{ data: '{"m":2}' }])
  })

  test('event: patch block calls the patch listener', async () => {
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(streamOf('event: patch\ndata: {}\n\n'))),
    )
    const t = instrument(es)
    const patches: MessageEventLike[] = []
    es.addEventListener('patch', (ev) => patches.push(ev))

    await until(t.ended)
    expect(patches).toEqual([{ data: '{}' }])
  })

  test('SSE comment fires a liveness tick but dispatches no data', async () => {
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(streamOf(': ping\n\n'))),
    )
    const t = instrument(es)

    await until(t.ended)
    // One bare tick per received chunk proves liveness to the watchdog.
    expect(t.messages).toEqual([{ data: undefined }])
    expect(t.dataMessages()).toEqual([])
  })

  test('multi-line data lines are joined with \\n', async () => {
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(streamOf('data: line1\ndata: line2\n\n'))),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.dataMessages()).toEqual([{ data: 'line1\nline2' }])
  })

  test('CRLF framing parses identically to LF', async () => {
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(
        okResponse(
          streamOf('event: evaluations\r\ndata: {"c":3}\r\n\r\ndata: plain\r\n\r\n'),
        ),
      ),
    )
    const t = instrument(es)
    const named: MessageEventLike[] = []
    es.addEventListener('evaluations', (ev) => named.push(ev))

    await until(t.ended)
    expect(named).toEqual([{ data: '{"c":3}' }])
    expect(t.dataMessages()).toEqual([{ data: 'plain' }])
  })

  test('a CRLF split across two chunks produces exactly one newline', async () => {
    // Chunk 1 ends with the \r of a \r\n pair. Without the pending-CR hold-back,
    // normalizing each chunk separately would turn one CRLF into two newlines and
    // split "a" and "b" into two separate events.
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(streamOf('data: a\r', '\ndata: b\r\n\r\n'))),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.dataMessages()).toEqual([{ data: 'a\nb' }])
  })

  test('a payload delivered in many small chunks at arbitrary byte boundaries (including mid-CRLF) parses identically to one whole chunk (functional-equivalence guard for the quadratic-parsing fix)', async () => {
    const payload =
      'event: put\ndata: {"a":1}\n\n' +
      'data: plain1\ndata: plain2\n\n' +
      'event: patch\r\ndata: {"b":2}\r\n\r\n' + // CRLF framing mixed in
      ': heartbeat\n\n' +
      'event: evaluations\ndata: {"c":3}\n\n'

    async function collect(chunks: (string | Uint8Array)[]) {
      const es = new FetchEventSource(
        'https://example.test/sse',
        {},
        fetchReturning(okResponse(streamOf(...chunks))),
      )
      const puts: MessageEventLike[] = []
      const patches: MessageEventLike[] = []
      const evaluations: MessageEventLike[] = []
      es.addEventListener('put', (ev) => puts.push(ev))
      es.addEventListener('patch', (ev) => patches.push(ev))
      es.addEventListener('evaluations', (ev) => evaluations.push(ev))
      const t = instrument(es)
      await until(t.ended)
      return { puts, patches, evaluations, dataMessages: t.dataMessages() }
    }

    const reference = await collect([payload])

    // Split at arbitrary 3-byte boundaries — several of which land mid-CRLF
    // (e.g. inside the '\r\n\r\n' block terminators above).
    const chunks: string[] = []
    for (let i = 0; i < payload.length; i += 3) {
      chunks.push(payload.slice(i, i + 3))
    }
    const chunked = await collect(chunks)

    expect(chunked).toEqual(reference)
    // Sanity: the reference itself actually parsed something meaningful, so
    // an accidentally-empty comparison couldn't slip through as "equal".
    expect(reference.evaluations).toEqual([{ data: '{"c":3}' }])
  })

  test('non-200 response reports onerror with the status', async () => {
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(
        Object.assign(okResponse(null), { ok: false, status: 500 }),
      ),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.errors).toEqual([{ status: 500 }])
    expect(t.opened).not.toHaveBeenCalled()
  })

  test('missing response.body is a terminal error', async () => {
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(undefined)),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.errors).toEqual([{ terminal: true }])
    expect(t.opened).not.toHaveBeenCalled()
  })

  test('a body without getReader (non-WHATWG stream) is terminal, onopen NOT fired', async () => {
    // e.g. node-fetch returns a Node.js Readable: truthy, but cannot stream here.
    const nodeReadableLike = {
      on: () => {},
      pipe: () => {},
    } as unknown as ReadableStream<Uint8Array>
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(nodeReadableLike)),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.errors).toEqual([{ terminal: true }])
    expect(t.opened).not.toHaveBeenCalled()
  })

  test('network error (fetch rejects) is passed to onerror', async () => {
    const boom = new Error('network down')
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      () => Promise.reject(boom),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.errors).toEqual([boom])
    expect(es.readyState).toBe(2)
  })

  test('close() aborts the request and swallows the AbortError', async () => {
    let capturedRequest: FetchRequestLike | undefined
    let rejectFetch!: (err: unknown) => void
    const fetchImpl: FetchLike = (_url, request) => {
      capturedRequest = request
      return new Promise((_resolve, reject) => {
        rejectFetch = reject
      })
    }
    const es = new FetchEventSource('https://example.test/sse', {}, fetchImpl)
    const t = instrument(es)

    es.close()
    expect(es.readyState).toBe(2)
    expect(capturedRequest?.signal?.aborted).toBe(true)

    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    rejectFetch(abortError)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(t.errors).toEqual([])
  })

  test('a stream that errors mid-read reports onerror without an unhandled rejection', async () => {
    const boom = new Error('stream broke')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: first\n\n'))
      },
      pull() {
        throw boom
      },
    })
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(okResponse(body)),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.dataMessages()).toEqual([{ data: 'first' }])
    // reader.cancel() on the errored stream rejects — must be swallowed, while
    // the original error still surfaces through onerror.
    expect(t.errors).toEqual([boom])
  })

  test('a stream ending mid multi-byte character flushes the decoder without crashing', async () => {
    // '€' is 0xE2 0x82 0xAC — send only the first two bytes, then end the stream.
    const es = new FetchEventSource(
      'https://example.test/sse',
      {},
      fetchReturning(
        okResponse(streamOf('data: ok\n\n', new Uint8Array([0xe2, 0x82]))),
      ),
    )
    const t = instrument(es)

    await until(t.ended)
    expect(t.dataMessages()).toEqual([{ data: 'ok' }])
    // Natural end-of-stream reports a recoverable (empty) error.
    expect(t.errors).toEqual([{}])
  })

  test('default headers are sent and caller headers win over them', async () => {
    let capturedRequest: FetchRequestLike | undefined
    const fetchImpl: FetchLike = (_url, request) => {
      capturedRequest = request
      return Promise.resolve(okResponse(streamOf()))
    }
    const es = new FetchEventSource(
      'https://example.test/sse',
      {
        headers: {
          Authorization: 'api-key-value',
          Accept: 'application/custom',
        },
        body: '{"tag":"t"}',
      },
      fetchImpl,
    )
    const t = instrument(es)

    await until(t.ended)
    expect(capturedRequest?.method).toBe('POST')
    expect(capturedRequest?.body).toBe('{"tag":"t"}')
    expect(capturedRequest?.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/custom', // caller override wins
      Authorization: 'api-key-value',
    })
  })

  test('the injected fetch is called receiver-free (regression: native fetch throws Illegal invocation if called as a method)', async () => {
    // Per WebIDL, a bare `fetch(...)` call is legal (`this` is `undefined` in
    // strict-mode ESM, or defaults to `globalThis` under non-strict/CJS
    // transpilation — both are the accepted "no explicit receiver" cases). A
    // *foreign* receiver — e.g. `this.fetchImpl(...)` passing the
    // FetchEventSource instance itself — is what real browser fetch rejects
    // with "Illegal invocation". Reproduce that brand check precisely so this
    // fails loudly if connect() ever regresses to a method-style call.
    let receiverCheckPassed = false
    const fetchImpl: FetchLike = function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation')
      }
      receiverCheckPassed = true
      return Promise.resolve(okResponse(streamOf('data: {"a":1}\n\n')))
    }
    const es = new FetchEventSource('https://example.test/sse', {}, fetchImpl)
    const t = instrument(es)

    await until(t.ended)

    expect(receiverCheckPassed).toBe(true)
    expect(t.opened).toHaveBeenCalledTimes(1)
    expect(t.dataMessages()).toEqual([{ data: '{"a":1}' }])
  })
})

import { afterEach, expect, suite, test, vi } from 'vitest'
import { loggingFetch } from '../../example/loggingFetch'
import type { StreamEvent } from '../../example/types'
import type { FetchRequestLike } from '../../src/internal/remote/fetch'

const encoder = new TextEncoder()

function streamOf(
  ...chunks: (string | Uint8Array)[]
): ReadableStream<Uint8Array> {
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

// A stream that fails instead of delivering anything, the way a connection
// that drops after its headers arrived does.
function failingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      controller.error(new Error('connection reset'))
    },
  })
}

function streamResponse(
  body: ReadableStream<Uint8Array> | null,
  init: { status?: number } = {},
): Response {
  const status = init.status ?? 200
  // Response rejects a body for 204/304 and for non-2xx here we only ever
  // pass null, so this covers every case the tests need.
  return new Response(body, { status, statusText: 'OK' })
}

const STREAM_URL = 'https://api.example.test/stream_evaluations'

function request(signal?: AbortSignal): FetchRequestLike {
  return { method: 'POST', headers: {}, body: '', signal }
}

// Runs `fn` and waits for the detached body watcher to finish reporting.
async function collect(fn: () => Promise<unknown>): Promise<void> {
  await fn()
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function recorder() {
  const events: StreamEvent[] = []
  const report = (event: StreamEvent) => events.push(event)
  const of = <K extends StreamEvent['kind']>(kind: K) =>
    events.filter(
      (e): e is Extract<StreamEvent, { kind: K }> => e.kind === kind,
    )
  return { events, report, of }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

suite('example/loggingFetch', () => {
  test('reports one sse event per complete block', async () => {
    const { report, of } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        streamResponse(streamOf('event: put\ndata: {"a":1}\n\n')),
      ),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('sse')).toEqual([
      { kind: 'sse', name: 'put', chars: '{"a":1}'.length },
    ])
  })

  test('CRLF split across chunks keeps the block whole', async () => {
    const { report, of } = recorder()
    // The '\r' of a '\r\n' lands at the end of one network chunk and its '\n'
    // at the start of the next. Normalizing each chunk on its own would turn
    // that into a blank line and end the block right after `event: put`.
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        streamResponse(streamOf('event: put\r', '\ndata: {"a":1}\r\n\r\n')),
      ),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('sse')).toEqual([
      { kind: 'sse', name: 'put', chars: '{"a":1}'.length },
    ])
  })

  test('CR-only line endings are understood', async () => {
    const { report, of } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        streamResponse(streamOf('event: patch\rdata: {"a":1}\r\r')),
      ),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('sse')).toEqual([
      {
        kind: 'sse',
        name: 'patch',
        chars: '{"a":1}'.length,
      },
    ])
  })

  test('a block arriving one byte at a time is reported once', async () => {
    const { report, of } = recorder()
    const payload = 'event: put\ndata: {"a":1}\n\n'
    const bytes = Array.from(encoder.encode(payload), (b) => Uint8Array.of(b))
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(streamOf(...bytes))),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('sse')).toEqual([
      { kind: 'sse', name: 'put', chars: '{"a":1}'.length },
    ])
  })

  test('a multi-byte character split across chunks is not corrupted', async () => {
    const { report, of } = recorder()
    const payload = encoder.encode('event: put\ndata: "日本"\n\n')
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        streamResponse(streamOf(payload.slice(0, 18), payload.slice(18))),
      ),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('sse')).toEqual([
      { kind: 'sse', name: 'put', chars: '"日本"'.length },
    ])
  })

  test('several blocks in one chunk are each reported', async () => {
    const { report, of } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        streamResponse(
          streamOf('event: put\ndata: 1\n\nevent: patch\ndata: 2\n\n'),
        ),
      ),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('sse').map((e) => e.name)).toEqual(['put', 'patch'])
  })

  test('a comment-only block is reported as a heartbeat', async () => {
    const { report, of } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(streamOf(': ping\n\n'))),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('heartbeat')).toHaveLength(1)
    expect(of('sse')).toHaveLength(0)
  })

  test('a large block split across many chunks is reported once, whole', async () => {
    const { report, of } = recorder()
    const data = 'x'.repeat(20_000)
    const block = `event: put\ndata: ${data}`
    const payload = `${block}\n\n`
    const chunks: string[] = []
    for (let i = 0; i < payload.length; i += 512) {
      chunks.push(payload.slice(i, i + 512))
    }
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(streamOf(...chunks))),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('sse')).toEqual([
      { kind: 'sse', name: 'put', chars: data.length },
    ])
  })

  test('an unterminated block at EOF is not reported', async () => {
    const { report, of } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(streamOf('event: put\ndata: {"a":1}'))),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('sse')).toHaveLength(0)
    expect(of('closed')).toHaveLength(1)
  })

  test('a clean EOF reports closed', async () => {
    const { report, of } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(streamOf('event: put\ndata: 1\n\n'))),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('closed')).toEqual([{ kind: 'closed', status: undefined }])
  })

  test('a failure while reading the body reports closed', async () => {
    const { report, of } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(failingStream())),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('closed')).toEqual([{ kind: 'closed', status: undefined }])
  })

  test('a read cut short by the SDK aborting does not report closed', async () => {
    const { report, of } = recorder()
    const controller = new AbortController()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(failingStream())),
    )

    await collect(async () => {
      const promise = loggingFetch(report)(
        STREAM_URL,
        request(controller.signal),
      )
      controller.abort()
      return promise
    })

    expect(of('closed')).toHaveLength(0)
  })

  test('the SDK still receives the body it would have received', async () => {
    const { report } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(streamOf('event: put\ndata: 1\n\n'))),
    )

    const response = await loggingFetch(report)(STREAM_URL, request())

    expect(response.status).toBe(200)
    expect(await new Response(response.body).text()).toBe(
      'event: put\ndata: 1\n\n',
    )
  })

  test('a non-2xx stream response reports closed with its status', async () => {
    const { report, of } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(null, { status: 401 })),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('closed')).toEqual([
      { kind: 'closed', status: 401, terminal: false },
    ])
  })

  test('a 2xx stream response with no body is reported as terminal', async () => {
    const { report, of } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(streamResponse(null, { status: 204 })),
    )

    await collect(() => loggingFetch(report)(STREAM_URL, request()))

    expect(of('closed')).toEqual([
      { kind: 'closed', status: undefined, terminal: true },
    ])
  })

  test('a fetch that rejects before headers reports closed and rethrows', async () => {
    const { report, of } = recorder()
    const failure = new Error('dns failure')
    vi.stubGlobal('fetch', () => Promise.reject(failure))

    await expect(loggingFetch(report)(STREAM_URL, request())).rejects.toThrow(
      failure,
    )
    expect(of('closed')).toEqual([{ kind: 'closed', status: undefined }])
  })

  test('an aborted fetch does not report closed', async () => {
    const { report, of } = recorder()
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('aborted')))

    await expect(
      loggingFetch(report)(STREAM_URL, request(controller.signal)),
    ).rejects.toThrow()
    expect(of('closed')).toHaveLength(0)
  })

  test('polling and event requests are logged but not watched as streams', async () => {
    const { report, events } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('{}', { status: 200 })),
    )

    await collect(() =>
      loggingFetch(report)(
        'https://api.example.test/get_evaluations',
        request(),
      ),
    )

    expect(events).toEqual([
      { kind: 'request', path: '/get_evaluations', method: 'POST' },
      { kind: 'response', path: '/get_evaluations', status: 200 },
    ])
  })

  test('an unrelated url is not reported at all', async () => {
    const { report, events } = recorder()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('{}', { status: 200 })),
    )

    await collect(() =>
      loggingFetch(report)('https://api.example.test/other', request()),
    )

    expect(events).toEqual([])
  })
})

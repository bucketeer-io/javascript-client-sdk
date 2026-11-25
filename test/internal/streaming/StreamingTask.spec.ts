import { expect, suite, test, vi, beforeEach, afterEach } from 'vitest'

import { BKTConfig } from '../../../src/BKTConfig'
import { DefaultComponent } from '../../../src/internal/di/Component'
import { SourceId } from '../../../src/internal/model/SourceId'
import { EvaluationTask } from '../../../src/internal/scheduler/EvaluationTask'
import {
  EventSourceErrorLike,
  EventSourceInstance,
  EventSourceLike,
  EventSourceLikeInit,
  MessageEventLike,
} from '../../../src/internal/streaming/EventSourceLike'
import { StreamingTask } from '../../../src/internal/streaming/StreamingTask'
import { SDK_VERSION } from '../../../src/internal/version'
import { FetchLike } from '../../../src/internal/remote/fetch'
import { buildTestComponent } from '../../utils'
import { user1 } from '../../mocks/users'
import { user1Evaluations } from '../../mocks/evaluations'

const RECOVERY_INTERVAL_MILLIS = 5 * 60_000

class FakeEventSource implements EventSourceInstance {
  static instances: FakeEventSource[] = []

  readyState = 0
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: MessageEventLike) => void) | null = null
  onerror: ((ev: EventSourceErrorLike | unknown) => void) | null = null
  closed = false

  private readonly listeners = new Map<
    string,
    Array<(ev: MessageEventLike) => void>
  >()

  constructor(
    public readonly url: string,
    public readonly init?: EventSourceLikeInit,
  ) {
    FakeEventSource.instances.push(this)
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

  emit(type: string, ev: MessageEventLike): void {
    this.listeners.get(type)?.forEach((listener) => listener(ev))
  }

  close(): void {
    this.closed = true
  }
}

function latest(): FakeEventSource {
  return FakeEventSource.instances[FakeEventSource.instances.length - 1]
}

suite('internal/streaming/StreamingTask', () => {
  let task: StreamingTask | undefined
  let evaluationTaskStart: ReturnType<typeof vi.spyOn>
  let evaluationTaskStop: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    FakeEventSource.instances = []
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    // The polling fallback is EvaluationTask's own concern — observe it via spies
    // so these tests exercise only StreamingTask's policy.
    evaluationTaskStart = vi
      .spyOn(EvaluationTask.prototype, 'start')
      .mockImplementation(() => {})
    evaluationTaskStop = vi
      .spyOn(EvaluationTask.prototype, 'stop')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    task?.stop()
    task = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function buildComponent(override: Partial<BKTConfig> = {}): DefaultComponent {
    // Injects the FakeEventSource by default; the shared builder applies the
    // rest. Object.assign, not spread, so an override can still set eventSource
    // (e.g. to undefined) without tripping the no-spread-after-defaults rule.
    return buildTestComponent(
      Object.assign(
        { eventSource: FakeEventSource as unknown as EventSourceLike },
        override,
      ),
    )
  }

  // Mirrors the real init order (BKTClient.ts's initializeBKTClientInternal()):
  // evaluationInteractor().initialize() always resolves before any task's
  // start() can read the cache. StreamingTask.start() synchronously reads it
  // via buildRequest() → getCurrentEvaluationsCondition(), which throws if
  // called too early — so tests must initialize() first, same as real usage.
  async function startTask(
    component: DefaultComponent,
  ): Promise<StreamingTask> {
    await component.evaluationInteractor().initialize()
    task = new StreamingTask(component)
    task.start()
    return task
  }

  test('buildRequest: POST to /stream_evaluations with the full header profile and body', async () => {
    await startTask(buildComponent())

    expect(FakeEventSource.instances).toHaveLength(1)
    const es = latest()
    expect(es.url).toBe('https://api.bucketeer.io/v1/gateway/stream_evaluations')
    expect(es.init?.method).toBe('POST')
    // The FULL profile must be here — injected transports receive it as-is.
    expect(es.init?.headers).toEqual({
      Authorization: 'api_key_value',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    })
    expect(JSON.parse(es.init?.body ?? '')).toEqual({
      tag: 'feature_tag_value',
      user: { id: user1.id, data: user1.data },
      sourceId: SourceId.JAVASCRIPT,
      sdkVersion: SDK_VERSION,
      // Storage is initialized but empty (fresh install, nothing cached yet)
      // — proto3 zero values.
      userEvaluationsId: '',
      evaluatedAt: '0',
    })
  })

  test('buildRequest includes the stored userEvaluationsId/evaluatedAt when available', async () => {
    const component = buildComponent()
    vi.spyOn(
      component.evaluationInteractor(),
      'getCurrentEvaluationsCondition',
    ).mockReturnValue({
      currentEvaluationsId: 'stored_evaluations_id',
      evaluatedAt: '1700000000',
    })
    await startTask(component)

    const body = JSON.parse(latest().init?.body ?? '')
    expect(body.userEvaluationsId).toBe('stored_evaluations_id')
    expect(body.evaluatedAt).toBe('1700000000')
  })

  test('without config.eventSource the built-in FetchEventSource is used', async () => {
    const fetchImpl = vi.fn(() => new Promise(() => {})) as unknown as FetchLike
    const component = buildComponent({
      eventSource: undefined,
      fetch: fetchImpl,
    })
    await startTask(component)

    // No injected fake constructed; the built-in transport went through fetch.
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, request] = vi.mocked(fetchImpl).mock.calls[0]
    expect(url).toBe('https://api.bucketeer.io/v1/gateway/stream_evaluations')
    expect(request.headers.Accept).toBe('text/event-stream')
    expect(request.headers.Authorization).toBe('api_key_value')
  })

  test('config.eventSource injected: the injected constructor is used', async () => {
    await startTask(buildComponent())
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  test('put event with valid JSON is applied via applyEvaluationsResponse', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    await startTask(component)

    const response = {
      evaluations: user1Evaluations,
      userEvaluationsId: 'user_evaluation_id_value',
    }
    latest().onopen?.({})
    latest().emit('put', { data: JSON.stringify(response) })
    await Promise.resolve()

    expect(apply).toHaveBeenCalledWith(response, expect.any(Function))
  })

  test('patch event with valid JSON is applied via applyEvaluationsResponse', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    await startTask(component)

    const response = {
      evaluations: user1Evaluations,
      userEvaluationsId: 'user_evaluation_id_value',
    }
    latest().onopen?.({})
    latest().emit('patch', { data: JSON.stringify(response) })
    await Promise.resolve()

    expect(apply).toHaveBeenCalledWith(response, expect.any(Function))
  })

  test('error event is logged distinctly and never applied', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await startTask(component)

    latest().onopen?.({})
    latest().emit('error', { data: '{"code":13,"message":"internal"}' })
    await Promise.resolve()

    expect(apply).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'StreamingTask: server reported a stream error',
      '{"code":13,"message":"internal"}',
    )
  })

  test('unnamed message event with valid JSON is applied via onUnhandledMessage', async () => {
    // Positive counterpart to the invalid-JSON/after-stop cases below: proves
    // the onUnhandledMessage → handleData wiring actually applies good data,
    // not just that it safely ignores bad data.
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    await startTask(component)

    const response = {
      evaluations: user1Evaluations,
      userEvaluationsId: 'user_evaluation_id_value',
    }
    latest().onopen?.({})
    latest().onmessage?.({ data: JSON.stringify(response) })
    await Promise.resolve()

    expect(apply).toHaveBeenCalledWith(response, expect.any(Function))
  })

  test('a payload that omits forceUpdate is applied (the backend may omit false booleans), routed through the update branch', async () => {
    // A protobuf-JSON marshaler that drops zero-valued fields sends no
    // forceUpdate key for a patch (forceUpdate=false). The shape check must
    // accept the omission — the REST path already tolerates it — instead of
    // silently dropping every streamed patch.
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    await startTask(component)

    const payload = {
      evaluations: {
        id: 'evaluations_id',
        evaluations: [],
        archivedFeatureIds: [],
        createdAt: '1700000000',
        // no forceUpdate key
      },
      userEvaluationsId: 'user_evaluation_id_value',
    }
    latest().onopen?.({})
    latest().emit('patch', { data: JSON.stringify(payload) })
    await Promise.resolve()

    expect(apply).toHaveBeenCalledWith(payload, expect.any(Function))
  })

  test('data event with invalid JSON is ignored', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    await startTask(component)

    latest().onopen?.({})
    latest().onmessage?.({ data: 'not-json' })
    await Promise.resolve()

    expect(apply).not.toHaveBeenCalled()
  })

  test('data event with valid JSON but the wrong shape (not a GetEvaluationsResponse) is ignored (defense in depth: a misrouted/malformed payload must not reach storage)', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    await startTask(component)

    latest().onopen?.({})
    for (const badPayload of [
      '{}',
      '{"userEvaluationsId":"x"}', // missing evaluations
      '{"userEvaluationsId":42,"evaluations":{"forceUpdate":false}}', // wrong type
      '{"userEvaluationsId":"x","evaluations":null}', // evaluations not an object
      '{"userEvaluationsId":"x","evaluations":{"forceUpdate":false}}', // missing createdAt
      '{"userEvaluationsId":"x","evaluations":{"createdAt":1700000000,"forceUpdate":false}}', // createdAt not a string
      '[]',
      'null',
    ]) {
      latest().onmessage?.({ data: badPayload })
    }
    await Promise.resolve()

    expect(apply).not.toHaveBeenCalled()
  })

  test('a payload missing createdAt is dropped instead of corrupting the staleness guard', async () => {
    // createdAt becomes evaluatedAt in storage. A missing/non-string value would
    // otherwise be accepted (Number(undefined) is NaN, and isStale()'s NaN
    // comparison is always false), writing evaluatedAt: undefined into the cache —
    // which then makes every SUBSEQUENT write pass the staleness guard too,
    // permanently disabling it for this user. This test documents that specific
    // failure mode, not just "wrong shape is ignored" (the test above).
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    await startTask(component)

    const payload = {
      evaluations: {
        id: 'evaluations_id',
        evaluations: [],
        archivedFeatureIds: [],
        // no createdAt
        forceUpdate: false,
      },
      userEvaluationsId: 'user_evaluation_id_value',
    }
    latest().onopen?.({})
    latest().emit('patch', { data: JSON.stringify(payload) })
    await Promise.resolve()

    expect(apply).not.toHaveBeenCalled()
  })

  test('applyEvaluationsResponse rejecting does not surface as an unhandled rejection', async () => {
    const component = buildComponent()
    const unhandled = vi.fn()
    // `process` only exists under the Node test runner (`vitest-node.config.ts`);
    // the browser runner (`vitest-browser.config.ts`) executes in a real Chrome via
    // webdriverio, where unhandled rejections surface through the window event instead.
    const isNode = typeof process !== 'undefined'
    const browserListener = (ev: unknown) => unhandled(ev)
    if (isNode) {
      process.on('unhandledRejection', unhandled)
    } else {
      globalThis.addEventListener('unhandledrejection', browserListener)
    }
    try {
      vi.spyOn(
        component.evaluationInteractor(),
        'applyEvaluationsResponse',
      ).mockRejectedValue(new Error('storage failure'))
      await startTask(component)

      const response = {
        evaluations: user1Evaluations,
        userEvaluationsId: 'user_evaluation_id_value',
      }
      latest().onopen?.({})
      latest().emit('put', { data: JSON.stringify(response) })
      await Promise.resolve()
      await Promise.resolve()

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      if (isNode) {
        process.off('unhandledRejection', unhandled)
      } else {
        globalThis.removeEventListener('unhandledrejection', browserListener)
      }
    }
  })

  test('data arriving after stop() is not applied', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    const t = await startTask(component)

    const es = latest()
    es.onopen?.({})
    t.stop()
    es.onmessage?.({ data: '{"evaluations":{},"userEvaluationsId":"x"}' })
    await Promise.resolve()

    expect(apply).not.toHaveBeenCalled()
  })

  test('shouldNotify passed to applyEvaluationsResponse reflects running, flips false after stop() mid-apply', async () => {
    // Covers the case 'data arriving after stop()' above does not: a destroy
    // racing an ALREADY-STARTED applyEvaluationsResponse call (e.g. stop()
    // runs while the storage write is in flight) must still be able to
    // suppress the update listeners once that write resolves.
    const component = buildComponent()
    let capturedShouldNotify: (() => boolean) | undefined
    vi.spyOn(
      component.evaluationInteractor(),
      'applyEvaluationsResponse',
    ).mockImplementation(async (_response, shouldNotify) => {
      capturedShouldNotify = shouldNotify
    })
    const t = await startTask(component)

    latest().onopen?.({})
    latest().emit('put', {
      data: '{"evaluations":{"createdAt":"1700000000","forceUpdate":false},"userEvaluationsId":"x"}',
    })
    await Promise.resolve()

    expect(capturedShouldNotify?.()).toBe(true)
    t.stop()
    expect(capturedShouldNotify?.()).toBe(false)
  })

  test('non-terminal error with fallback enabled starts polling AND arms recovery', async () => {
    await startTask(buildComponent())

    // Never-opened + non-recoverable, non-terminal status (an unclassified
    // 4xx — neither in httpStatus.ts's TERMINAL_STATUSES nor its recoverable
    // set) → StreamConnection gives up immediately, no backoff retry.
    latest().onerror?.({ status: 402 })

    // start(true) fetches immediately instead of arming a timer for the next
    // poll (up to 10 min by default) — otherwise a stream drop would leave
    // users on stale evaluations for that whole window.
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)

    // Recovery fires after 5 minutes: streaming reopens; fallback stops once
    // onOpen proves the reopened stream actually works (no polling gap).
    vi.advanceTimersByTime(RECOVERY_INTERVAL_MILLIS)
    expect(FakeEventSource.instances).toHaveLength(2)
    latest().onopen?.({})
    expect(evaluationTaskStop).toHaveBeenCalled()
  })

  test.each([400, 413, 422])(
    'error with status %i (body-dependent 4xx) starts polling AND arms recovery, same as any other non-terminal error',
    async (status) => {
      await startTask(buildComponent())

      latest().onerror?.({ status })

      expect(evaluationTaskStart).toHaveBeenCalledWith(true)

      vi.advanceTimersByTime(RECOVERY_INTERVAL_MILLIS)
      expect(FakeEventSource.instances).toHaveLength(2)
      latest().onopen?.({})
      expect(evaluationTaskStop).toHaveBeenCalled()
    },
  )

  test('terminal error starts fallback but never schedules recovery', async () => {
    await startTask(buildComponent())

    latest().onerror?.({ status: 401 })

    expect(evaluationTaskStart).toHaveBeenCalledWith(true)
    // No recovery timer pending — streaming is not retried for terminal errors.
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(30 * 60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  test('an unhealthy stream that exceeds the give-up window without ever getting a status starts the polling fallback', async () => {
    // Arrange: a connection needs to open once before it can drop.
    await startTask(buildComponent())

    // Act: it opens, then drops with no status attached at all (e.g. a
    // plain network blip). StreamConnection treats an undefined status as
    // recoverable, so this starts a backoff retry loop instead of an
    // immediate give-up — unlike the 402/400/413/422 cases above, which
    // give up on the very first error.
    latest().onopen?.({})
    latest().onerror?.({}) // unhealthy clock starts here

    // Act: every retry fails the same way, with backoff escalating
    // 1,2,4,8,16,30,30s (jitter mocked to 0 in beforeEach). The assertion
    // inside the loop proves the give-up genuinely waits for the full 120s
    // window, it does not fire on the first, second, or any early drop.
    for (const delaySeconds of [1, 2, 4, 8, 16, 30, 30]) {
      vi.advanceTimersByTime(delaySeconds * 1_000)
      expect(evaluationTaskStart).not.toHaveBeenCalled()
      latest().onerror?.({})
    }
    // Act: one more failure past the 120s window, the drop that finally
    // makes StreamConnection give up with { terminal: false } even though
    // no HTTP status was ever involved in this whole sequence.
    vi.advanceTimersByTime(30_000) // 121s since the first failure
    latest().onerror?.({})

    // Assert: the poller must start on this status-less give-up path too,
    // not only on give-ups that carry a recognizable HTTP status.
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)
  })

  test('a stream that answers every connection with only a server error event gives up and starts the polling fallback', async () => {
    // Context: what the server sends here.
    // When an evaluation fails, the server answers the stream request with
    // HTTP 200, then one `event: error` with "evaluation failed", then it
    // ends the stream. This test repeats that answer on every connection,
    // so the stream receives no put.
    //
    // Expected SDK behavior: after 120 s with no working connection, the
    // stream gives up and starts the polling fallback, the same as for any
    // other connection that keeps failing.
    //
    // How the 120 s window works: StreamConnection resets its give-up
    // window each time the stream shows it is alive. On these connections
    // two signals arrive:
    //   1. FetchEventSource sends an empty message for every chunk it reads
    //      (a liveness tick), before it reads the events in the chunk.
    //   2. The `error` event, which carries data.
    // Neither signal may reset the window here, or the window never
    // reaches 120 s.
    //
    // This test uses the built-in FetchEventSource with a fake fetch,
    // instead of FakeEventSource, because only FetchEventSource sends the
    // liveness tick.

    // Arrange (step 1): a fake fetch. Each call is one connection, and gets
    // the same bytes the server sends: 200, one error event, then the end of
    // the stream (the reader gets done).
    const errorOnlyStream = () => ({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: error\ndata: {"code":"INTERNAL","message":"evaluation failed"}\n\n',
            ),
          )
          controller.close()
        },
      }),
    })
    const fetchImpl = vi.fn(() =>
      Promise.resolve(errorOnlyStream()),
    ) as unknown as FetchLike
    // StreamingTask logs each server error event. Silenced to keep the test
    // output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Arrange (step 2): start the task. eventSource: undefined makes
    // StreamingTask use the built-in FetchEventSource with the fake fetch
    // above.
    await startTask(
      buildComponent({ eventSource: undefined, fetch: fetchImpl }),
    )

    // Act (step 3): advance 3 minutes. Expected timeline (backoff jitter
    // mocked to 0 in beforeEach, so retries come 1, 2, 4, 8, 16, 30, 30, 30 s
    // apart):
    //   0 s    first connection: 200, error, end of stream. The window
    //          starts.
    //   121 s  a connection ends and the window is past 120 s: give-up, and
    //          the polling fallback starts.
    // advanceTimersByTimeAsync, not advanceTimersByTime: FetchEventSource
    // reads the stream with promises, which must run between the timers.
    await vi.advanceTimersByTimeAsync(3 * 60_000)

    // Assert (step 4): the stream gave up and started the polling fallback,
    // which fetches at once (true). EvaluationTask.start is mocked in
    // beforeEach, so the fallback makes no request here.
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)
  })

  // The tests below use the built-in FetchEventSource with a fake fetch, like
  // the test above, so every connection gets real server bytes, including the
  // per-chunk liveness tick. They cover answers where the stream must NOT
  // give up early, so a fix for the error-only answers cannot go too far.
  suite('server answers where the stream keeps going', () => {
    const encoder = new TextEncoder()
    const putEvent = `event: put\ndata: ${JSON.stringify({
      evaluations: user1Evaluations,
      userEvaluationsId: 'user_evaluation_id_value',
    })}\n\n`
    const errorEvent =
      'event: error\ndata: {"code":"INTERNAL","message":"evaluation failed"}\n\n'
    const heartbeat = ':\n\n'

    // One stream connection: a 200 answer whose body the test writes to and
    // ends, like the server does.
    interface FakeConnection {
      send: (text: string) => void
      end: () => void
    }

    // A fake fetch. Each call is one connection. answer() decides, by
    // connection number (0 = first), what that connection gets. It returns
    // either an HTTP status for a failed try, or undefined for a 200 answer.
    function fakeServer(
      answer: (connection: FakeConnection, index: number) => number | undefined,
    ) {
      const connections: FakeConnection[] = []
      const fetchImpl = vi.fn(() => {
        let controller!: ReadableStreamDefaultController<Uint8Array>
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
          },
        })
        const connection: FakeConnection = {
          send: (text) => controller.enqueue(encoder.encode(text)),
          end: () => controller.close(),
        }
        connections.push(connection)
        const status = answer(connection, connections.length - 1)
        return Promise.resolve(
          status === undefined
            ? { ok: true, status: 200, body }
            : { ok: false, status, body: null },
        )
      }) as unknown as FetchLike
      return { fetchImpl, connections }
    }

    async function startWith(fetchImpl: FetchLike): Promise<void> {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const component = buildComponent({
        eventSource: undefined,
        fetch: fetchImpl,
      })
      // The put's storage write is not what these tests check.
      vi.spyOn(
        component.evaluationInteractor(),
        'applyEvaluationsResponse',
      ).mockResolvedValue(undefined)
      await startTask(component)
    }

    test('a put then an error on every connection (holdout snapshot missing) does not give up', async () => {
      // Context: when the server evaluates without its holdout snapshot, it
      // sends the put, then `event: error` "holdout snapshot unavailable,
      // retry", then ends the stream, so the next connection gets a full
      // evaluation. Each connection still delivers current evaluations, so
      // the stream works and must not give up.

      // Arrange (step 1): every connection gets 200, a put, an error, then
      // the end of the stream.
      const server = fakeServer((connection) => {
        connection.send(putEvent)
        connection.send(errorEvent)
        connection.end()
        return undefined
      })
      await startWith(server.fetchImpl)

      // Act (step 2): advance 3 minutes, well past the 120 s give-up window.
      // The backoff grows to 30 s, so about 10 connections happen.
      await vi.advanceTimersByTimeAsync(3 * 60_000)

      // Assert (step 3): the put on each connection counts as a working
      // stream, so the stream did not give up and no polling fallback started.
      expect(evaluationTaskStart).not.toHaveBeenCalled()
    })

    test('a failed patch after a long working connection retries with backoff instead of giving up at once', async () => {
      // Context: the window starts with a failed try. The next connection
      // works for 5 minutes (a put, then heartbeats). Then a patch fails, so
      // the server sends `event: error` and ends the stream. The 5 working
      // minutes must count: the stream retries as after any single drop,
      // and does not treat the window as running since the first failure.

      // Arrange (step 1): connection 0 fails with 503 (the window starts).
      // Connection 1 gets a put and stays open; the test drives it below.
      // Later connections get a put and stay open.
      const server = fakeServer((connection, index) => {
        if (index === 0) return 503
        connection.send(putEvent)
        return undefined
      })
      await startWith(server.fetchImpl)

      // Act (step 2): the first retry comes after 1 s (jitter mocked to 0).
      await vi.advanceTimersByTimeAsync(1_000)

      // Act (step 3): connection 1 works for 5 minutes. A heartbeat every
      // 30 s keeps the 70 s watchdog from tripping.
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(30_000)
        server.connections[1].send(heartbeat)
      }

      // Act (step 4): a patch fails: error event, then the end of the stream.
      // The connection was open for more than 60 s, so the backoff was
      // reset and the next retry comes after 1 s.
      server.connections[1].send(errorEvent)
      server.connections[1].end()
      await vi.advanceTimersByTimeAsync(2_000)

      // Assert (step 5): no give-up, so no polling fallback started.
      expect(evaluationTaskStart).not.toHaveBeenCalled()
      // Assert (step 6): the stream retried: a third connection was opened.
      expect(server.fetchImpl).toHaveBeenCalledTimes(3)
    })

    test('a put after failed tries restarts the give-up window from the put', async () => {
      // Context: tries fail with 503, then one connection delivers a put and
      // ends, then tries fail again. The put proves the stream worked, so the
      // 120 s give-up window must start again after it, not from the first
      // failure.

      // Arrange (step 1): connection 7 (at 91 s, backoff 1, 2, 4, 8, 16, 30,
      // 30 s with jitter mocked to 0) gets a put and then the end of the
      // stream. Every other connection fails with 503.
      const server = fakeServer((connection, index) => {
        if (index !== 7) return 503
        connection.send(putEvent)
        connection.end()
        return undefined
      })
      await startWith(server.fetchImpl)

      // Act (step 2): advance to 200 s. Counted from the first failure (0 s),
      // the window would have given up at 121 s. Counted from the put
      // (91 s), it gives up only after 211 s.
      await vi.advanceTimersByTimeAsync(200_000)

      // Assert (step 3): the put restarted the window, so no give-up yet.
      expect(evaluationTaskStart).not.toHaveBeenCalled()

      // Act (step 4): advance to 250 s. The retries after the put come at
      // 121, 151, 181, 211 and 241 s. At 241 s the window from the put is
      // 150 s, so the stream gives up.
      await vi.advanceTimersByTimeAsync(50_000)

      // Assert (step 5): the window still ends: failures after the put lead
      // to a give-up and the polling fallback.
      expect(evaluationTaskStart).toHaveBeenCalledWith(true)
    })
  })

  test('a synchronously throwing eventSource constructor starts the polling fallback', async () => {
    // Arrange: an injected transport that fails before it can even open.
    // openConnection() wraps `new eventSource(...)` in try/catch specifically
    // to survive a misbehaving injected EventSourceLike like this one.
    class ThrowingEventSource {
      constructor() {
        throw new Error('boom')
      }
    }

    // Act: start() runs openStream() synchronously, so the throw and the
    // resulting give-up both happen before startTask() resolves, no timer
    // advance is needed to observe the outcome.
    await startTask(
      buildComponent({
        eventSource: ThrowingEventSource as unknown as EventSourceLike,
      }),
    )

    // Assert: this give-up never produced an EventSourceErrorLike at all
    // (construction failed before there was a connection to report on), so
    // it must still start the poller like every other give-up path.
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)
  })

  test('a terminal give-up warns once that streaming has stopped permanently', async () => {
    // Arrange: capture console.warn so it doesn't print during the test run
    // and so its calls can be asserted on.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startTask(buildComponent())

    // Act: a terminal status (bad API key). Streaming can never recover
    // from this on its own, only destroy + re-initialize brings it back.
    latest().onerror?.({ status: 401 })

    // Assert: polling still takes over so evaluations keep updating...
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)
    // ...and the app is told, exactly once, that streaming itself is gone
    // for good, a state that used to be completely silent.
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  test('a non-terminal give-up does not warn', async () => {
    // Arrange: same capture as the terminal case above, for the same reason.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startTask(buildComponent())

    // Act: a non-terminal give-up (an unclassified 4xx). This one is
    // expected to self-heal later via the 5-minute recovery timer, so it is
    // not the same kind of permanent loss as the terminal case.
    latest().onerror?.({ status: 402 })

    // Assert: the poller starts the same as any give-up...
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)
    // ...but nothing is printed, so a flaky network cannot spam the console,
    // and the terminal warning above stays meaningful when it does appear.
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('onOpen after recovery cancels fallback and leaves no recovery pending', async () => {
    await startTask(buildComponent())

    latest().onerror?.({ status: 402 }) // unclassified 4xx → fallback + recovery
    vi.advanceTimersByTime(RECOVERY_INTERVAL_MILLIS) // recovery reopens the stream
    expect(FakeEventSource.instances).toHaveLength(2)

    latest().onopen?.({})
    expect(evaluationTaskStop).toHaveBeenCalled()
    // Only the connection's own timers remain (watchdog + backoff-reset) —
    // no 5-minute recovery timer is pending anymore.
    expect(vi.getTimerCount()).toBe(2)
  })

  test('recovery timer reopening the stream does not stop the fallback poller until onOpen succeeds (regression: no polling gap during the reconnect attempt)', async () => {
    await startTask(buildComponent())

    latest().onerror?.({ status: 402 }) // → fallback + recovery
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)

    vi.advanceTimersByTime(RECOVERY_INTERVAL_MILLIS) // recovery timer reopens the stream
    expect(FakeEventSource.instances).toHaveLength(2)
    // The new stream hasn't proven it opened yet — the poller must still be running.
    expect(evaluationTaskStop).not.toHaveBeenCalled()

    latest().onopen?.({})
    expect(evaluationTaskStop).toHaveBeenCalled()
  })

  test('reconnect() from fallback mode does not stop the fallback poller until onOpen succeeds (regression: no polling gap during the reconnect attempt)', async () => {
    const t = await startTask(buildComponent())

    latest().onerror?.({ status: 402 }) // → fallback + recovery
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)

    t.reconnect()
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(evaluationTaskStop).not.toHaveBeenCalled()

    latest().onopen?.({})
    expect(evaluationTaskStop).toHaveBeenCalled()
  })

  test('reconnect()-opened stream plus a previously armed recovery timer produces only one live connection (openStream() must be defensive)', async () => {
    const t = await startTask(buildComponent())

    latest().onerror?.({ status: 402 }) // → fallback + recovery timer armed for +5min
    t.reconnect() // opens a fresh stream while the recovery timer is still pending
    expect(FakeEventSource.instances).toHaveLength(2)
    latest().onopen?.({}) // new stream succeeds — resets its own watchdog

    // Keep the new connection healthy so its OWN watchdog/backoff machinery
    // never fires an extra connection — isolating whether the STALE recovery
    // timer (armed before reconnect(), at the original failure) fires one.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(60_000)
      latest().onmessage?.({ data: undefined })
    }

    // The stale recovery timer (armed ~5 min ago) must not have fired a third connection.
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  test('a terminal error on a reconnect-opened stream leaves no stale recovery timer to reopen it (openStream() must clear the recovery timer armed by the earlier failure)', async () => {
    // The onOpen path clears the recovery timer via stopFallback(), so the
    // 'only one live connection' test above does not actually exercise
    // openStream()'s own clearTimeout. This path does: the reconnect stream
    // never opens — it fails terminally — so onOpen never runs, and
    // handleError(terminal) does NOT re-arm recovery. Only openStream()'s
    // entry clearTimeout can cancel the timer armed by the ORIGINAL failure,
    // or it fires 5 min later and reopens a stream that was permanently dead.
    const t = await startTask(buildComponent())

    latest().onerror?.({ status: 402 }) // non-terminal → fallback + recovery armed
    t.reconnect() // fallback mode → openStream() opens a fresh stream
    expect(FakeEventSource.instances).toHaveLength(2)

    latest().onerror?.({ status: 401 }) // reconnect stream fails terminally

    // The original failure's recovery timer must have been cleared at reconnect;
    // otherwise it fires here and opens a third connection on a dead stream.
    vi.advanceTimersByTime(RECOVERY_INTERVAL_MILLIS)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  test('onOpen clears the userAttributesUpdated flag using the state captured when the request was built', async () => {
    const component = buildComponent()
    await component.evaluationInteractor().initialize()
    await component.evaluationInteractor().setUserAttributesUpdated()
    expect(
      component.evaluationInteractor().getUserAttributesState()
        .userAttributesUpdated,
    ).toBe(true)

    task = new StreamingTask(component)
    task.start() // buildRequest() runs synchronously here, capturing the flag=true snapshot

    latest().onopen?.({})
    // clearUserAttributesUpdated() is fire-and-forget from onOpen and goes
    // through the storage mutex + a storage write, so it needs a few
    // microtask ticks to actually land (fake timers are active in this
    // suite, so this flushes microtasks directly rather than via a timer).
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
    }

    expect(
      component.evaluationInteractor().getUserAttributesState()
        .userAttributesUpdated,
    ).toBe(false)
  })

  test('userAttributesUpdated set after buildRequest() but before onOpen survives the clear (regression: a race must not wipe a newer flag)', async () => {
    const component = buildComponent()
    await startTask(component) // buildRequest() captures updateSequence at flag=false

    // Simulates updateUserAttributes() racing between connect and open.
    await component.evaluationInteractor().setUserAttributesUpdated()
    expect(
      component.evaluationInteractor().getUserAttributesState()
        .userAttributesUpdated,
    ).toBe(true)

    latest().onopen?.({})
    await Promise.resolve()

    expect(
      component.evaluationInteractor().getUserAttributesState()
        .userAttributesUpdated,
    ).toBe(true)
  })

  test('connect failure never clears the userAttributesUpdated flag (must survive for the polling fallback)', async () => {
    const component = buildComponent()
    await component.evaluationInteractor().initialize()
    await component.evaluationInteractor().setUserAttributesUpdated()

    task = new StreamingTask(component)
    task.start()

    latest().onerror?.({ status: 500 }) // never opened — onOpen never fires
    await Promise.resolve()

    expect(
      component.evaluationInteractor().getUserAttributesState()
        .userAttributesUpdated,
    ).toBe(true)
  })

  test('reconnect() while streaming opens exactly one fresh connection with fresh attributes', async () => {
    const component = buildComponent()
    const t = await startTask(component)
    latest().onopen?.({})

    component.userHolder().updateAttributes(() => ({ plan: 'premium' }))
    t.reconnect()

    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[0].closed).toBe(true)
    const body = JSON.parse(latest().init?.body ?? '')
    expect(body.user.data).toEqual({ plan: 'premium' })

    // No stale backoff/reconnect timer may open a third connection.
    vi.advanceTimersByTime(30_000)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  test('reconnect() rebuilds the body with the latest stored userEvaluationsId/evaluatedAt', async () => {
    const component = buildComponent()
    const conditionSpy = vi.spyOn(
      component.evaluationInteractor(),
      'getCurrentEvaluationsCondition',
    )
    conditionSpy.mockReturnValue({ currentEvaluationsId: '', evaluatedAt: '0' })
    const t = await startTask(component)
    latest().onopen?.({})

    // Storage advanced between the first connect and the reconnect (e.g. a
    // put/patch was applied) — buildRequest() is re-invoked on every
    // (re)connect, so it must pick up the new values, not the stale ones.
    conditionSpy.mockReturnValue({
      currentEvaluationsId: 'updated_evaluations_id',
      evaluatedAt: '1700000999',
    })
    t.reconnect()

    const body = JSON.parse(latest().init?.body ?? '')
    expect(body.userEvaluationsId).toBe('updated_evaluations_id')
    expect(body.evaluatedAt).toBe('1700000999')
  })

  test('reconnect() while on polling fallback jumps straight back to streaming', async () => {
    const t = await startTask(buildComponent())

    latest().onerror?.({ status: 402 }) // unclassified 4xx → fallback + recovery
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)

    t.reconnect()

    expect(FakeEventSource.instances).toHaveLength(2)
    // The old recovery timer was cancelled — the only pending timer is the new
    // connection's watchdog. (Advancing time instead would trip that watchdog
    // on the silent fake connection and self-heal reconnects would fire.)
    expect(vi.getTimerCount()).toBe(1)

    // Fallback stops once onOpen proves the reopened stream actually works
    // (no polling gap in between).
    latest().onopen?.({})
    expect(evaluationTaskStop).toHaveBeenCalled()
  })

  test('reconnect() after a 413 reopens the stream with the corrected attributes (unlike a genuinely terminal error, the request can differ on retry)', async () => {
    const component = buildComponent()
    const t = await startTask(component)

    latest().onerror?.({ status: 413 }) // oversized user.data
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)
    expect(FakeEventSource.instances).toHaveLength(1)

    // App shrinks the attributes that caused the 413, then updates them.
    component.userHolder().updateAttributes(() => ({ plan: 'basic' }))
    t.reconnect()

    expect(FakeEventSource.instances).toHaveLength(2)
    const body = JSON.parse(latest().init?.body ?? '')
    expect(body.user.data).toEqual({ plan: 'basic' })

    latest().onopen?.({})
    expect(evaluationTaskStop).toHaveBeenCalled()
  })

  test('reconnect() after a terminal error is a no-op (stream is permanently dead; fallback keeps polling untouched)', async () => {
    const t = await startTask(buildComponent())

    latest().onerror?.({ status: 401 }) // bad API key (terminal)
    expect(evaluationTaskStart).toHaveBeenCalledWith(true)
    expect(FakeEventSource.instances).toHaveLength(1)

    t.reconnect()

    // No new connection, and the fallback poller was never touched (it must
    // keep running on its own schedule — same as pure polling mode, where
    // updateUserAttributes() doesn't force an immediate fetch either).
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(evaluationTaskStop).not.toHaveBeenCalled()
  })

  test('stop() stops connection, fallback, and recovery', async () => {
    const t = await startTask(buildComponent())

    latest().onerror?.({ status: 402 }) // unclassified 4xx → fallback + recovery
    t.stop()

    expect(t.isRunning()).toBe(false)
    expect(evaluationTaskStop).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(30 * 60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })
})

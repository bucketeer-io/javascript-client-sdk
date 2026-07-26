import { expect, suite, test, vi, beforeEach, afterEach } from 'vitest'
import { StreamConnection } from '../../../src/internal/streaming/StreamConnection'
import {
  EventSourceErrorLike,
  EventSourceInstance,
  EventSourceLike,
  EventSourceLikeInit,
  MessageEventLike,
} from '../../../src/internal/streaming/EventSourceLike'

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

// Regression coverage: the backoff reset used to be a timestamp comparison inside
// Backoff itself, gated on success(), which only fires once per connection (on
// onopen) — so the reset never fired for the ordinary stable-then-drop case. It is
// now a timer owned here: armed on open, canceled if the connection drops first.
suite('internal/streaming/StreamConnection — backoff reset timer', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function startConnection(): StreamConnection {
    const conn = new StreamConnection({
      eventSource: FakeEventSource as unknown as EventSourceLike,
      requestBuilder: () => ({ url: 'https://example.test/sse' }),
      events: {},
      callbacks: { onOpen: vi.fn(), onError: vi.fn() },
    })
    conn.start()
    return conn
  }

  test('a connection that stays open 60s resets the delay before its next drop', () => {
    startConnection()

    // Two quick failures escalate the delay: 1_000ms, then 2_000ms.
    FakeEventSource.instances[0].onopen?.({})
    FakeEventSource.instances[0].onerror?.({})
    vi.advanceTimersByTime(1_000) // -> instance #2 opens
    FakeEventSource.instances[1].onopen?.({})
    FakeEventSource.instances[1].onerror?.({})
    vi.advanceTimersByTime(2_000) // -> instance #3 opens
    expect(FakeEventSource.instances).toHaveLength(3)

    // This time, stay open long enough to be proven stable, then drop.
    FakeEventSource.instances[2].onopen?.({})
    vi.advanceTimersByTime(60_000)
    FakeEventSource.instances[2].onerror?.({})

    // If the reset took effect, the next retry is back at the initial 1_000ms delay,
    // not the 4_000ms it would be had attempt kept escalating.
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(3)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(4)
  })

  test('a connection that drops before 60s keeps escalating (flapping protection)', () => {
    startConnection()

    FakeEventSource.instances[0].onopen?.({})
    FakeEventSource.instances[0].onerror?.({})
    vi.advanceTimersByTime(1_000) // -> instance #2 opens, attempt now 1

    // Opens again, but drops well before the 60s reset window elapses.
    FakeEventSource.instances[1].onopen?.({})
    vi.advanceTimersByTime(5_000)
    FakeEventSource.instances[1].onerror?.({})

    // Delay should still be the escalated 2_000ms, not reset back to 1_000ms.
    vi.advanceTimersByTime(1_999)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(3)
  })
})

suite('internal/streaming/StreamConnection — health model', () => {
  let onOpen: ReturnType<typeof vi.fn>
  let onError: ReturnType<typeof vi.fn>
  let messageHandler: ReturnType<typeof vi.fn>
  let namedHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    FakeEventSource.instances = []
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    onOpen = vi.fn()
    onError = vi.fn()
    messageHandler = vi.fn()
    namedHandler = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function startConnection(): StreamConnection {
    const conn = new StreamConnection({
      eventSource: FakeEventSource as unknown as EventSourceLike,
      requestBuilder: () => ({ url: 'https://example.test/sse' }),
      events: {
        evaluations: namedHandler,
      },
      onUnhandledMessage: messageHandler,
      callbacks: { onOpen, onError },
    })
    conn.start()
    return conn
  }

  test('open then event: onOpen called, data dispatched, watchdog reset', () => {
    startConnection()
    latest().onopen?.({})
    expect(onOpen).toHaveBeenCalledTimes(1)

    latest().onmessage?.({ data: '{"a":1}' })
    expect(messageHandler).toHaveBeenCalledWith('{"a":1}')

    latest().emit('evaluations', { data: '{"b":2}' })
    expect(namedHandler).toHaveBeenCalledWith('{"b":2}')

    // A bare liveness tick (data: undefined) resets the watchdog but carries no data.
    latest().onmessage?.({ data: undefined })
    expect(messageHandler).toHaveBeenCalledTimes(1)

    // Watchdog was just reset — 69_999ms of silence does not reconnect...
    vi.advanceTimersByTime(69_999)
    expect(FakeEventSource.instances).toHaveLength(1)
    // ...but the 70_000ms mark trips it and schedules a reconnect.
    vi.advanceTimersByTime(1)
    vi.advanceTimersByTime(1_000)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(onError).not.toHaveBeenCalled()
  })

  test('a named event with no data (e.g. a connection-error signal) does not reset the watchdog — it still trips on schedule', () => {
    // Regression guard: see the decision chart above openConnection()'s event
    // wiring in StreamConnection.ts. A named event with no data (like a native
    // EventSource's connection-error 'error' event) is a failure signal, not
    // proof the stream is working — it must not reset the watchdog, or a
    // repeatedly failing connection could mask itself as healthy forever.
    startConnection()
    latest().onopen?.({})

    vi.advanceTimersByTime(69_000)
    latest().emit('evaluations', { data: undefined })
    expect(namedHandler).not.toHaveBeenCalled() // no data → handler not invoked

    // The dataless named event must NOT have reset the watchdog: only 1_000ms
    // remain until the original 70s mark set at onopen.
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1) // watchdog trips → scheduleReconnect()
    vi.advanceTimersByTime(1_000) // backoff delay → instance #2
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  test('liveness tracking works even with no events map and no onUnhandledMessage', () => {
    // Structural guarantee: the message/liveness channel is wired
    // unconditionally in openConnection(), not gated behind the caller
    // supplying events or onUnhandledMessage. Built independently of the
    // shared startConnection() helper (which always supplies
    // onUnhandledMessage) to prove the guarantee holds with neither present.
    const conn = new StreamConnection({
      eventSource: FakeEventSource as unknown as EventSourceLike,
      requestBuilder: () => ({ url: 'https://example.test/sse' }),
      events: {},
      callbacks: { onOpen, onError },
    })
    conn.start()
    latest().onopen?.({})

    // Nothing but bare liveness ticks (data: undefined) for several watchdog
    // intervals — no put/patch/error, no onUnhandledMessage wired at all.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(60_000)
      latest().onmessage?.({ data: undefined })
    }

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
  })

  test('transient error after open self-heals with backoff, onError NOT called', () => {
    startConnection()
    latest().onopen?.({})
    latest().onerror?.({})

    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(onError).not.toHaveBeenCalled()
  })

  test('healthy for 10 min then a single drop reconnects — does NOT give up', () => {
    startConnection()
    latest().onopen?.({})

    // Stay healthy for 10 minutes: an event every 60s keeps the watchdog fed.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(60_000)
      latest().onmessage?.({ data: undefined })
    }
    expect(FakeEventSource.instances).toHaveLength(1)

    // Single drop after a long healthy life must self-heal, not fall back.
    latest().onerror?.({})
    vi.advanceTimersByTime(1_000)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(onError).not.toHaveBeenCalled()
  })

  test('unhealthy > 120s with no events in between gives up non-terminal', () => {
    startConnection()
    latest().onopen?.({})
    latest().onerror?.({}) // unhealthy clock starts

    // Drops keep failing; delays escalate 1,2,4,8,16,30,30,30 (jitter mocked to 0).
    // Cumulative unhealthy time passes 120s on the last error below.
    for (const delaySeconds of [1, 2, 4, 8, 16, 30, 30]) {
      vi.advanceTimersByTime(delaySeconds * 1_000)
      expect(onError).not.toHaveBeenCalled()
      latest().onerror?.({})
    }
    vi.advanceTimersByTime(30_000) // now 121s since the first failure
    latest().onerror?.({})
    expect(onError).toHaveBeenCalledWith({ terminal: false })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  test('an event received between drops restarts the unhealthy window', () => {
    startConnection()
    latest().onopen?.({})
    latest().onerror?.({}) // t=0: unhealthy clock starts
    vi.advanceTimersByTime(1_000)
    latest().onerror?.({})
    vi.advanceTimersByTime(2_000) // t=3s: instance #3

    // Data arrives → healthy again, window cleared.
    latest().onmessage?.({ data: undefined })
    latest().onerror?.({}) // t=3s: NEW unhealthy window starts here

    // Same escalation as before; at t=121s only 118s of THIS window have
    // elapsed, so the give-up that would fire without the event must not.
    for (const delaySeconds of [4, 8, 16, 30, 30, 30]) {
      vi.advanceTimersByTime(delaySeconds * 1_000)
      latest().onerror?.({})
    }
    // t=121s — without the healthy event this would have given up already.
    expect(onError).not.toHaveBeenCalled()

    vi.advanceTimersByTime(30_000) // t=151s: 148s into the restarted window
    latest().onerror?.({})
    expect(onError).toHaveBeenCalledWith({ terminal: false })
  })

  test('connect that hangs without ever opening gives up once the window elapses', () => {
    startConnection()

    // No onopen ever fires. The watchdog doubles as the connect timeout.
    vi.advanceTimersByTime(70_000) // watchdog trips → unhealthy clock starts
    vi.advanceTimersByTime(1_000) // backoff → instance #2
    expect(FakeEventSource.instances).toHaveLength(2)

    vi.advanceTimersByTime(70_000) // second trip: 71s unhealthy → still retries
    vi.advanceTimersByTime(2_000) // backoff → instance #3
    expect(FakeEventSource.instances).toHaveLength(3)
    expect(onError).not.toHaveBeenCalled()

    vi.advanceTimersByTime(70_000) // third trip: 143s unhealthy → give up
    expect(onError).toHaveBeenCalledWith({ terminal: false })
    expect(FakeEventSource.instances).toHaveLength(3)
  })

  test('reconnect() while a backoff retry is pending produces exactly one new connection', () => {
    const conn = startConnection()
    latest().onopen?.({})
    latest().onerror?.({}) // backoff retry scheduled in 1s
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].closed).toBe(true)

    conn.reconnect() // must clear the pending timer and open immediately
    expect(FakeEventSource.instances).toHaveLength(2)

    // The stale backoff timer must not fire a third connection.
    vi.advanceTimersByTime(10_000)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[1].closed).toBe(false)
  })

  test.each([401, 403])('error with status %i gives up terminal, no retry', (status) => {
    startConnection()
    latest().onerror?.({ status })
    expect(onError).toHaveBeenCalledWith({ terminal: true })
    expect(FakeEventSource.instances[0].closed).toBe(true)

    vi.advanceTimersByTime(300_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  test('error with terminal: true from the EventSource gives up terminal, no retry', () => {
    startConnection()
    latest().onopen?.({})
    latest().onerror?.({ terminal: true })
    expect(onError).toHaveBeenCalledWith({ terminal: true })

    vi.advanceTimersByTime(300_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  test('error before first open with a recoverable status retries with backoff instead of giving up immediately (regression: previously gave up on the very first failed connect attempt)', () => {
    startConnection()
    latest().onerror?.({ status: 500 })
    expect(onError).not.toHaveBeenCalled()
    expect(FakeEventSource.instances).toHaveLength(1)

    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  test('repeated recoverable pre-open errors eventually give up once the unhealthy window elapses (same bound as the post-open case)', () => {
    startConnection()
    latest().onerror?.({ status: 500 }) // unhealthy clock starts

    // Delays escalate 1,2,4,8,16,30,30,30 (jitter mocked to 0) — same schedule
    // as the post-open 'unhealthy > 120s' case above.
    for (const delaySeconds of [1, 2, 4, 8, 16, 30, 30]) {
      vi.advanceTimersByTime(delaySeconds * 1_000)
      expect(onError).not.toHaveBeenCalled()
      latest().onerror?.({ status: 500 })
    }
    vi.advanceTimersByTime(30_000) // now 121s since the first failure
    latest().onerror?.({ status: 500 })
    expect(onError).toHaveBeenCalledWith({ terminal: false })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  test('events and errors from a stale (replaced) EventSource instance are ignored', () => {
    startConnection()
    const stale = latest()
    stale.onopen?.({})
    stale.onerror?.({}) // → closed, retry in 1s
    vi.advanceTimersByTime(1_000)
    const current = latest()
    expect(FakeEventSource.instances).toHaveLength(2)
    current.onopen?.({})
    expect(onOpen).toHaveBeenCalledTimes(2)

    // A misbehaving replaced instance fires late events: all must be ignored.
    stale.onopen?.({})
    expect(onOpen).toHaveBeenCalledTimes(2)
    stale.onmessage?.({ data: 'late' })
    expect(messageHandler).not.toHaveBeenCalled()
    stale.onerror?.({ status: 401 })
    expect(onError).not.toHaveBeenCalled()
    expect(current.closed).toBe(false)
  })

  test('stop() clears timers, closes the EventSource, and ignores later errors', () => {
    const conn = startConnection()
    latest().onopen?.({})
    latest().onerror?.({}) // backoff retry pending

    conn.stop()
    expect(FakeEventSource.instances[0].closed).toBe(true)

    // Neither the pending retry nor the watchdog may fire after stop().
    vi.advanceTimersByTime(300_000)
    expect(FakeEventSource.instances).toHaveLength(1)

    FakeEventSource.instances[0].onerror?.({})
    expect(onError).not.toHaveBeenCalled()
  })
})

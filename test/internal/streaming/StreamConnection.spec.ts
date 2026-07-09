import { expect, suite, test, vi, beforeEach, afterEach } from 'vitest'
import { StreamConnection } from '../../../src/internal/streaming/StreamConnection'
import {
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
  onerror: ((ev: { status?: number } | unknown) => void) | null = null
  closed = false

  constructor(
    public readonly url: string,
    public readonly init?: EventSourceLikeInit,
  ) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  close(): void {
    this.closed = true
  }
}

// Regression coverage for REPORTS/CyberAgent/2026/07/JS-004/ISSUES/BACKOFF_RESET_NEVER_FIRES.md:
// the backoff reset is now a timer owned here, armed on open and canceled on close, instead of
// a timestamp comparison inside Backoff itself.
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

import { expect, suite, test, vi, beforeEach, afterEach } from 'vitest'

import { BKTConfig, defineBKTConfig } from '../../../src/BKTConfig'
import { DefaultComponent } from '../../../src/internal/di/Component'
import { DataModule } from '../../../src/internal/di/DataModule'
import { InteractorModule } from '../../../src/internal/di/InteractorModule'
import { requiredInternalConfig } from '../../../src/internal/InternalConfig'
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
import { TestPlatformModule } from '../../utils'
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
    // Object.assign, not spread: the no-spread-after-defaults lint rule forbids
    // spreading a source over already-applied defaults. Overriding with an
    // explicit undefined (e.g. eventSource) is intentional here.
    const config = defineBKTConfig(
      Object.assign(
        {
          apiKey: 'api_key_value',
          apiEndpoint: 'https://api.bucketeer.io',
          featureTag: 'feature_tag_value',
          appVersion: '1.2.3',
          enableStreaming: true,
          eventSource: FakeEventSource as unknown as EventSourceLike,
          fetch: () => new Promise(() => {}), // never used with the injected fake
        },
        override,
      ),
    )
    return new DefaultComponent(
      new TestPlatformModule(),
      new DataModule(user1, requiredInternalConfig(config)),
      new InteractorModule(),
    )
  }

  function startTask(component: DefaultComponent): StreamingTask {
    task = new StreamingTask(component)
    task.start()
    return task
  }

  test('buildRequest: POST to /stream_evaluations with the full header profile and body', () => {
    startTask(buildComponent())

    expect(FakeEventSource.instances).toHaveLength(1)
    const es = latest()
    expect(es.url).toBe('https://api.bucketeer.io/stream_evaluations')
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
      // No cached state yet (storage is never initialize()'d in these tests,
      // mirroring the real pre-initialize first connect) — proto3 zero values.
      userEvaluationsId: '',
      evaluatedAt: '0',
    })
  })

  test('buildRequest includes the stored userEvaluationsId/evaluatedAt when available', () => {
    const component = buildComponent()
    vi.spyOn(
      component.evaluationInteractor(),
      'getCurrentEvaluationsCondition',
    ).mockReturnValue({
      currentEvaluationsId: 'stored_evaluations_id',
      evaluatedAt: '1700000000',
    })
    startTask(component)

    const body = JSON.parse(latest().init?.body ?? '')
    expect(body.userEvaluationsId).toBe('stored_evaluations_id')
    expect(body.evaluatedAt).toBe('1700000000')
  })

  test('without config.eventSource the built-in FetchEventSource is used', () => {
    const fetchImpl = vi.fn(
      () => new Promise(() => {}),
    ) as unknown as FetchLike
    const component = buildComponent({
      eventSource: undefined,
      fetch: fetchImpl,
    })
    startTask(component)

    // No injected fake constructed; the built-in transport went through fetch.
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, request] = vi.mocked(fetchImpl).mock.calls[0]
    expect(url).toBe('https://api.bucketeer.io/stream_evaluations')
    expect(request.headers.Accept).toBe('text/event-stream')
    expect(request.headers.Authorization).toBe('api_key_value')
  })

  test('config.eventSource injected: the injected constructor is used', () => {
    startTask(buildComponent())
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  test('put event with valid JSON is applied via applyEvaluationsResponse', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    startTask(component)

    const response = {
      evaluations: user1Evaluations,
      userEvaluationsId: 'user_evaluation_id_value',
    }
    latest().onopen?.({})
    latest().emit('put', { data: JSON.stringify(response) })
    await Promise.resolve()

    expect(apply).toHaveBeenCalledWith(response)
  })

  test('patch event with valid JSON is applied via applyEvaluationsResponse', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    startTask(component)

    const response = {
      evaluations: user1Evaluations,
      userEvaluationsId: 'user_evaluation_id_value',
    }
    latest().onopen?.({})
    latest().emit('patch', { data: JSON.stringify(response) })
    await Promise.resolve()

    expect(apply).toHaveBeenCalledWith(response)
  })

  test('error event is logged distinctly and never applied', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    startTask(component)

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
    startTask(component)

    const response = {
      evaluations: user1Evaluations,
      userEvaluationsId: 'user_evaluation_id_value',
    }
    latest().onopen?.({})
    latest().onmessage?.({ data: JSON.stringify(response) })
    await Promise.resolve()

    expect(apply).toHaveBeenCalledWith(response)
  })

  test('data event with invalid JSON is ignored', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    startTask(component)

    latest().onopen?.({})
    latest().onmessage?.({ data: 'not-json' })
    await Promise.resolve()

    expect(apply).not.toHaveBeenCalled()
  })

  test('applyEvaluationsResponse rejecting does not surface as an unhandled rejection', async () => {
    const component = buildComponent()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      vi
        .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
        .mockRejectedValue(new Error('storage failure'))
      startTask(component)

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
      process.off('unhandledRejection', unhandled)
    }
  })

  test('data arriving after stop() is not applied', async () => {
    const component = buildComponent()
    const apply = vi
      .spyOn(component.evaluationInteractor(), 'applyEvaluationsResponse')
      .mockResolvedValue(undefined)
    const t = startTask(component)

    const es = latest()
    es.onopen?.({})
    t.stop()
    es.onmessage?.({ data: '{"evaluations":{},"userEvaluationsId":"x"}' })
    await Promise.resolve()

    expect(apply).not.toHaveBeenCalled()
  })

  test('non-terminal error with fallback enabled starts polling AND arms recovery', () => {
    startTask(buildComponent())

    // Never-opened + recoverable status → StreamConnection gives up non-terminal.
    latest().onerror?.({ status: 500 })

    expect(evaluationTaskStart).toHaveBeenCalledTimes(1)

    // Recovery fires after 5 minutes: fallback stops, streaming reopens.
    vi.advanceTimersByTime(RECOVERY_INTERVAL_MILLIS)
    expect(evaluationTaskStop).toHaveBeenCalled()
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  test('non-terminal error with fallback DISABLED still arms recovery', () => {
    startTask(buildComponent({ streamingFallbackToPolling: false }))

    latest().onerror?.({ status: 500 })

    // No polling fallback...
    expect(evaluationTaskStart).not.toHaveBeenCalled()
    // ...but streaming must not be permanently dead: recovery still reopens it.
    vi.advanceTimersByTime(RECOVERY_INTERVAL_MILLIS)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  test('terminal error starts fallback but never schedules recovery', () => {
    startTask(buildComponent())

    latest().onerror?.({ status: 401 })

    expect(evaluationTaskStart).toHaveBeenCalledTimes(1)
    // No recovery timer pending — streaming is not retried for terminal errors.
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(30 * 60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  test('onOpen after recovery cancels fallback and leaves no recovery pending', () => {
    startTask(buildComponent())

    latest().onerror?.({ status: 500 }) // → fallback + recovery
    vi.advanceTimersByTime(RECOVERY_INTERVAL_MILLIS) // recovery reopens the stream
    expect(FakeEventSource.instances).toHaveLength(2)

    latest().onopen?.({})
    expect(evaluationTaskStop).toHaveBeenCalled()
    // Only the connection's own timers remain (watchdog + backoff-reset) —
    // no 5-minute recovery timer is pending anymore.
    expect(vi.getTimerCount()).toBe(2)
  })

  test('reconnect() while streaming opens exactly one fresh connection with fresh attributes', () => {
    const component = buildComponent()
    const t = startTask(component)
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

  test('reconnect() rebuilds the body with the latest stored userEvaluationsId/evaluatedAt', () => {
    const component = buildComponent()
    const conditionSpy = vi.spyOn(
      component.evaluationInteractor(),
      'getCurrentEvaluationsCondition',
    )
    conditionSpy.mockReturnValue({ currentEvaluationsId: '', evaluatedAt: '0' })
    const t = startTask(component)
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

  test('reconnect() while on polling fallback jumps straight back to streaming', () => {
    const t = startTask(buildComponent())

    latest().onerror?.({ status: 500 }) // → fallback + recovery
    expect(evaluationTaskStart).toHaveBeenCalledTimes(1)

    t.reconnect()

    expect(evaluationTaskStop).toHaveBeenCalled()
    expect(FakeEventSource.instances).toHaveLength(2)
    // The old recovery timer was cancelled — the only pending timer is the new
    // connection's watchdog. (Advancing time instead would trip that watchdog
    // on the silent fake connection and self-heal reconnects would fire.)
    expect(vi.getTimerCount()).toBe(1)
  })

  test('stop() stops connection, fallback, and recovery', () => {
    const t = startTask(buildComponent())

    latest().onerror?.({ status: 500 }) // → fallback + recovery
    t.stop()

    expect(t.isRunning()).toBe(false)
    expect(evaluationTaskStop).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(30 * 60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })
})

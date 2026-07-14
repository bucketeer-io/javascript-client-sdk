import { Component } from '../di/Component'
import { requiredInternalConfig } from '../InternalConfig'
import { StreamEvaluationsRequest } from '../model/request/StreamEvaluationsRequest'
import { GetEvaluationsResponse } from '../model/response/GetEvaluationsResponse'
import { EvaluationTask } from '../scheduler/EvaluationTask'
import { ScheduledTask } from '../scheduler/ScheduledTask'
import { FetchEventSource } from './FetchEventSource'
import { EventSourceLike, EventSourceLikeInit } from './EventSourceLike'
import { StreamConnection, StreamConnectionErrorInfo } from './StreamConnection'

const STREAM_EVALUATIONS_PATH = '/stream_evaluations'
const RECOVERY_INTERVAL_MILLIS = 5 * 60_000

export class StreamingTask implements ScheduledTask {
  private connection: StreamConnection | null = null
  private fallbackTask: EvaluationTask | null = null
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined
  private running = false

  constructor(private readonly component: Component) {}

  isRunning(): boolean {
    return this.running
  }

  start(): void {
    this.running = true
    this.openStream()
  }

  // Called by TaskScheduler.reconnectStreaming() on user attribute change.
  reconnect(): void {
    if (!this.running) return
    if (this.connection) {
      // Transport re-invokes requestBuilder → picks up fresh attributes.
      this.connection.reconnect()
    } else {
      // Currently on polling fallback (or idle after a terminal error) —
      // jump straight back to streaming.
      this.stopFallback()
      this.openStream()
    }
  }

  stop(): void {
    this.running = false
    this.connection?.stop()
    this.connection = null
    this.stopFallback()
  }

  // private

  private openStream(): void {
    const config = requiredInternalConfig(this.component.config())
    // Prefer the user-injected EventSource; fall back to our FetchEventSource.
    const eventSource: EventSourceLike =
      config.eventSource ?? this.makeFetchEventSourceClass()

    this.connection = new StreamConnection({
      eventSource,
      requestBuilder: () => this.buildRequest(),
      events: {
        // handleData is async; the events map requires void-returning handlers,
        // so the call is explicitly caught here — otherwise a rejection (e.g. a
        // storage failure) would surface as an unhandled promise rejection.
        // Backend event names (evaluations.go): 'put' is the full snapshot sent
        // once after connecting, 'patch' is a per-change diff.
        put: (data) => {
          this.handleData(data).catch((e) => {
            console.error('StreamingTask: failed to handle put event', e)
          })
        },
        patch: (data) => {
          this.handleData(data).catch((e) => {
            console.error('StreamingTask: failed to handle patch event', e)
          })
        },
        // The backend sends this right before closing the stream to report an
        // internal error. Handle it distinctly instead of letting it fall
        // through to handleData, which would JSON-parse it fine and then throw
        // on the missing GetEvaluationsResponse shape.
        error: (data) => {
          console.error('StreamingTask: server reported a stream error', data)
        },
      },
      // Defensive fallback for a message that matched none of the named
      // handlers above — a genuinely unnamed SSE event (the SSE/EventSource
      // standard's 'message' default — see EventSourceLike.ts). This backend
      // always names its events (put/patch/error), so this normally never
      // fires with data. StreamConnection tracks liveness on this channel
      // unconditionally, whether or not this callback is provided.
      onUnhandledMessage: (data) => {
        this.handleData(data).catch((e) => {
          console.error('StreamingTask: failed to handle message event', e)
        })
      },
      callbacks: {
        onOpen: () => this.stopFallback(),
        onError: (info) => this.handleError(info),
      },
    })
    this.connection.start()
  }

  // Returns an EventSourceLike constructor that closes over config.fetch, so the
  // standard StreamConnection interface can call `new eventSource(url, init)`.
  private makeFetchEventSourceClass(): EventSourceLike {
    const fetch = requiredInternalConfig(this.component.config()).fetch
    return class extends FetchEventSource {
      constructor(url: string, init?: EventSourceLikeInit) {
        super(url, init ?? {}, fetch)
      }
    }
  }

  // Single unified POST body profile — identical on every platform.
  // Credentials go in the Authorization header; user identification in the body.
  // The FULL header profile lives here so injected EventSourceLike
  // implementations receive a complete request; the built-in FetchEventSource
  // merely re-asserts the same Content-Type/Accept defaults defensively.
  private buildRequest(): { url: string; init: EventSourceLikeInit } {
    const config = requiredInternalConfig(this.component.config())
    const user = this.component.userHolder().get()
    // Re-read on every (re)connect (this method is re-invoked by
    // StreamConnection's requestBuilder), so a reconnect always carries the
    // latest cached state — the backend can then reply with a diff instead of
    // a full snapshot. Same '' / '0' defaults as the polling path
    // (EvaluationInteractor.fetch()) for a fresh install that has never
    // cached any evaluations yet (getCurrentEvaluationsCondition() is always
    // called after initialize() — see its own comment — so these defaults
    // handle "initialized but empty," not "not yet initialized").
    const condition = this.component
      .evaluationInteractor()
      .getCurrentEvaluationsCondition()
    const body: StreamEvaluationsRequest = {
      tag: config.featureTag,
      user: { id: user.id, data: user.data },
      sourceId: config.sourceId,
      sdkVersion: config.sdkVersion,
      userEvaluationsId: condition.currentEvaluationsId ?? '',
      evaluatedAt: condition.evaluatedAt ?? '0',
    }
    return {
      url: `${config.apiEndpoint}${STREAM_EVALUATIONS_PATH}`,
      init: {
        method: 'POST',
        headers: {
          Authorization: config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      },
    }
  }

  private handleError(info: StreamConnectionErrorInfo): void {
    if (!this.running) return
    this.connection?.stop()
    this.connection = null
    this.startFallback()
    if (!info.terminal) {
      // Terminal failures (bad API key, streaming unsupported) are not retried;
      // everything else gets a streaming retry after the recovery interval.
      this.scheduleRecovery()
    }
  }

  private async handleData(data: string): Promise<void> {
    if (!this.running) return // guard: data may arrive after stop()
    let response: GetEvaluationsResponse
    try {
      response = JSON.parse(data) as GetEvaluationsResponse
    } catch {
      return
    }
    await this.component
      .evaluationInteractor()
      .applyEvaluationsResponse(response)
  }

  private startFallback(): void {
    if (!this.component.config().streamingFallbackToPolling) return
    if (!this.fallbackTask) {
      this.fallbackTask = new EvaluationTask(this.component)
      this.fallbackTask.start()
    }
  }

  private scheduleRecovery(): void {
    clearTimeout(this.recoveryTimer)
    this.recoveryTimer = setTimeout(() => {
      if (!this.running) return
      this.stopFallback()
      this.openStream()
    }, RECOVERY_INTERVAL_MILLIS)
  }

  private stopFallback(): void {
    this.fallbackTask?.stop()
    this.fallbackTask = null
    clearTimeout(this.recoveryTimer)
    this.recoveryTimer = undefined
  }
}

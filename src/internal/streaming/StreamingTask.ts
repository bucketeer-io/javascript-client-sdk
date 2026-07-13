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
        evaluations: (data) => {
          this.handleData(data).catch((e) => {
            console.error(
              'StreamingTask: failed to handle evaluations event',
              e,
            )
          })
        },
        message: (data) => {
          this.handleData(data).catch((e) => {
            console.error('StreamingTask: failed to handle message event', e)
          })
        },
        heartbeat: () => {}, // liveness only — receiving it already marks healthy
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
    const body: StreamEvaluationsRequest = {
      tag: config.featureTag,
      user: { id: user.id, data: user.data },
      sourceId: config.sourceId,
      sdkVersion: config.sdkVersion,
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

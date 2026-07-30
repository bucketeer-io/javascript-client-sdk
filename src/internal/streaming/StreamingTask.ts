import { Component } from '../di/Component'
import { UserAttributesState } from '../evaluation/EvaluationStorage'
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

// Minimal structural check, not full validation: just enough to stop a
// misrouted/malformed payload from being blind-cast and handed to
// EvaluationStorage's writes. See handleData()'s defense-in-depth comment.
function isGetEvaluationsResponseShape(
  value: unknown,
): value is GetEvaluationsResponse {
  if (typeof value !== 'object' || value === null) return false
  const response = value as Record<string, unknown>
  if (typeof response.userEvaluationsId !== 'string') return false
  const evaluations = response.evaluations
  if (typeof evaluations !== 'object' || evaluations === null) return false
  return (
    typeof (evaluations as Record<string, unknown>).forceUpdate === 'boolean'
  )
}

export class StreamingTask implements ScheduledTask {
  private connection: StreamConnection | null = null
  private fallbackTask: EvaluationTask | null = null
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined
  private running = false
  // Snapshot captured by buildRequest(); onOpen clears the flag with it, so
  // only a request that actually carried these attributes can clear the flag
  // they belong to. See EvaluationStorage.clearUserAttributesUpdated().
  private lastRequestAttributesState: UserAttributesState | undefined
  // Set by handleError() on a terminal failure (bad API key, streaming
  // unsupported) — reconnect() must not retry streaming in that case, only
  // the polling fallback remains viable. See reconnect() and handleError().
  //
  // WARNING — never reset, by design: today every start() runs on a freshly
  // constructed StreamingTask (TaskScheduler builds a new one on every
  // scheduleTasks() call — see BKTClient.ts), so this field starting false
  // per instance is enough. If a start()/stop() REUSE pattern is ever added
  // to this class, start() MUST reset this to false there, or a restarted
  // task will stay permanently stuck on the polling fallback because of a
  // previous instance's terminal error.
  private terminalFailure = false

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
    // Stream is permanently dead (bad API key, streaming unsupported) — the
    // polling fallback keeps running untouched, exact parity with pure
    // polling mode where updateUserAttributes() doesn't force an immediate
    // fetch either.
    if (this.terminalFailure) return
    if (this.connection) {
      // Transport re-invokes requestBuilder → picks up fresh attributes.
      this.connection.reconnect()
    } else {
      // Currently on polling fallback (or idle after a terminal error) — jump
      // straight back to streaming. No stopFallback() here: the poller keeps
      // running until onOpen proves the new stream actually works (onOpen
      // calls stopFallback() itself) — otherwise there'd be a polling gap for
      // however long this attempt takes to open or fail.
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
    // Defensive at entry: every caller today already guarantees no live
    // connection/timer (previously via stopFallback(), which cleared both),
    // but reconnect()'s fallback branch and the recovery timer no longer call
    // stopFallback() first — see those call sites. Without this, a pending
    // recovery timer could fire after this method already opened a fresh
    // connection and create a second, leaked StreamConnection.
    this.connection?.stop()
    this.connection = null
    clearTimeout(this.recoveryTimer)

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
        onOpen: () => {
          this.stopFallback()
          this.clearUserAttributesUpdated()
        },
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
    // Captured (not sent — the backend re-evaluates from user.data on every
    // reconnect, no wire field needed) so onOpen can clear the flag only if
    // it's still the latest snapshot. See EvaluationStorage.
    // clearUserAttributesUpdated() and the onOpen callback below.
    this.lastRequestAttributesState = this.component
      .evaluationInteractor()
      .getUserAttributesState()
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

  // Called from onOpen: this connection's request carried the attributes in
  // lastRequestAttributesState, so it's safe to clear — but only if no newer
  // setUserAttributesUpdated() call has landed since (guarded by
  // EvaluationStorage.clearUserAttributesUpdated()'s sequence check). A
  // failed connect never calls this, so the flag survives for the polling
  // fallback to send.
  private clearUserAttributesUpdated(): void {
    const state = this.lastRequestAttributesState
    if (!state) return
    this.component
      .evaluationInteractor()
      .clearUserAttributesUpdated(state)
      .catch((e) => {
        console.error(
          'StreamingTask: failed to clear userAttributesUpdated flag',
          e,
        )
      })
  }

  private handleError(info: StreamConnectionErrorInfo): void {
    if (!this.running) return
    this.connection?.stop()
    this.connection = null
    this.startFallback()
    if (info.terminal) {
      // Remembered so reconnect() (e.g. a later updateUserAttributes() call)
      // doesn't retry a permanently dead stream — see reconnect().
      this.terminalFailure = true
    } else {
      // Terminal failures (bad API key, streaming unsupported) are not retried;
      // everything else gets a streaming retry after the recovery interval.
      this.scheduleRecovery()
    }
  }

  private async handleData(data: string): Promise<void> {
    if (!this.running) return // guard: data may arrive after stop()
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    // Defense in depth: even with FetchEventSource routing named events with
    // no listener away from onmessage, a shape check here stops any other
    // misrouted/malformed payload (not just an unknown event name) from
    // reaching deleteAllAndInsert()/update() with garbage.
    if (!isGetEvaluationsResponseShape(parsed)) return
    const response = parsed
    // shouldNotify is re-checked after the awaited storage write: a stop()/
    // destroy racing that write must not fire update listeners into
    // torn-down app code (the write itself may land — unused cached data).
    await this.component
      .evaluationInteractor()
      .applyEvaluationsResponse(response, () => this.running)
  }

  private startFallback(): void {
    if (!this.component.config().streamingFallbackToPolling) return
    if (!this.fallbackTask) {
      this.fallbackTask = new EvaluationTask(this.component)
      // Named instead of passed as a bare literal so the call site reads on
      // its own, without needing to check start()'s signature.
      const immediately = true
      this.fallbackTask.start(immediately) // fetch immediately instead of waiting a full pollingInterval
    }
  }

  private scheduleRecovery(): void {
    clearTimeout(this.recoveryTimer)
    this.recoveryTimer = setTimeout(() => {
      if (!this.running) return
      // No stopFallback() here: the poller keeps running until onOpen proves
      // the reopened stream actually works — otherwise every 5-minute
      // recovery attempt would open a polling gap for as long as it takes to
      // open or fail (see openStream()'s onOpen callback and its own
      // defensive clearTimeout(this.recoveryTimer) at entry).
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

import {
  BKTEvaluationSyncSource,
  BKTEvaluationSyncStatus,
  BKTEvaluationSyncStatusListener,
} from '../../BKTEvaluationSyncStatus'
import { BKTException } from '../../BKTExceptions'
import { Clock } from '../Clock'
import { IdGenerator } from '../IdGenerator'
import { EvaluationSyncReporter } from './EvaluationSyncReporter'
import { StreamingSyncReporter } from './StreamingSyncReporter'

// What BKTClient needs: the public API and the lifecycle. It cannot report results.
export interface EvaluationSyncStatusTracker {
  getStatus(): BKTEvaluationSyncStatus
  addListener(listener: BKTEvaluationSyncStatusListener): string
  removeListener(id: string): void
  clearListeners(): void
  // Marks init as finished. A failed init request passes no error: the state
  // stays INITIALIZING until the poller or the stream reports after its
  // retries. error: an init error not related to the request, which sets
  // FAILING at once (only while the state is still INITIALIZING).
  finishInitializing(succeeded: boolean, error?: BKTException): void
  markDestroyed(): void
}

// How long a stream give-up waits before it is applied. Right after a
// give-up, the polling fallback polls at once. When only the stream is broken,
// that poll succeeds in well under 1 s and cancels the wait, so the app does
// not see FAILING and then SYNCED again.
export const STREAM_GIVE_UP_WAIT_MILLIS = 10_000

// Holds the one sync status of the client and calls its listeners.
//
// - INITIALIZING lasts until the first sync result. A success sets SYNCED at
//   once. A failure reported before init finishes updates lastError only.
// - A failure is reported only when a sync flow is finished (the poller after
//   its retries, the stream at give-up). A reported failure sets FAILING.
// - A stream give-up waits STREAM_GIVE_UP_WAIT_MILLIS before it is applied.
//   A success or destroy during the wait cancels it. A polling failure during
//   the wait applies the stream error at once (see reportFailure()).
// - An init error not related to the request sets FAILING at once, through
//   finishInitializing().
// - Listeners are called on every state change and on every failure that is
//   not ignored (see isIgnoredFailure()).
// - A change to lastSyncedAt alone calls no listener, or every stream
//   heartbeat would call them.
//
// Only Component sees this class. Each caller gets only the interface it uses.
export class EvaluationSyncStatusTrackerImpl
  implements
    EvaluationSyncStatusTracker,
    EvaluationSyncReporter,
    StreamingSyncReporter
{
  private status: BKTEvaluationSyncStatus
  private listeners: Record<string, BKTEvaluationSyncStatusListener> = {}
  // true from a stream put/patch until the stream is marked as not working
  // or gives up.
  private streamWorking = false
  private pollingFallbackActive = false
  // Lets a failure reported after init move INITIALIZING to FAILING.
  private initFinished = false
  // The pending stream give-up, if any. One at most. The error is kept with
  // its timer, so a polling failure during the wait can apply it at once.
  private pendingStreamGiveUp:
    | {
        timer: ReturnType<typeof setTimeout>
        error: BKTException
        occurredAt: number
      }
    | undefined

  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {
    this.status = {
      state: 'INITIALIZING',
      changedAt: clock.currentTimeMillis(),
      lastSyncedAt: null,
      lastError: null,
    }
  }

  // A copy, so app code cannot change the status.
  getStatus(): BKTEvaluationSyncStatus {
    const { lastError } = this.status
    return Object.assign({}, this.status, {
      lastError: lastError && Object.assign({}, lastError),
    })
  }

  addListener(listener: BKTEvaluationSyncStatusListener): string {
    const id = this.idGenerator.newId()
    this.listeners[id] = listener
    return id
  }

  removeListener(id: string): void {
    delete this.listeners[id]
  }

  clearListeners(): void {
    this.listeners = {}
  }

  finishInitializing(succeeded: boolean, error?: BKTException): void {
    this.initFinished = true
    if (succeeded || !error || this.status.state !== 'INITIALIZING') return
    this.setState('FAILING')
    // Set together with the state, so listeners get one call with both.
    this.setLastError('POLLING', error, this.clock.currentTimeMillis())
    this.notifyListeners()
  }

  markDestroyed(): void {
    if (this.isDestroyed()) return
    this.cancelStreamGiveUp()
    this.setState('DESTROYED')
    this.notifyListeners()
    this.clearListeners()
  }

  reportSuccess(source: BKTEvaluationSyncSource): void {
    if (this.isDestroyed()) return
    if (source === 'STREAMING') this.streamWorking = true
    this.cancelStreamGiveUp()

    // Already SYNCED: only lastSyncedAt moves, with no listener call.
    const changed = this.status.state !== 'SYNCED'
    if (changed) this.setState('SYNCED')
    this.updateLastSyncedAt()
    if (changed) this.notifyListeners()
  }

  reportFailure(source: BKTEvaluationSyncSource, error: BKTException): void {
    if (this.isDestroyed()) return
    if (source === 'STREAMING') this.streamWorking = false
    if (this.isIgnoredFailure(source)) return

    const occurredAt = this.clock.currentTimeMillis()
    if (source === 'POLLING') {
      const pending = this.pendingStreamGiveUp
      if (pending) {
        // A polling failure during the 10 s stream give-up wait ends the wait
        // at once with the pending stream error, not the polling error. This
        // is a product decision: the polling fallback only stands in for the
        // stream, and the stream gives up only after all its reconnects
        // failed, so the stream error is the real cause. Other ways would also
        // work (report the polling error, or hold it until the wait ends), but
        // they are not the chosen behavior. A later polling failure, with no
        // wait pending, sets the polling error as usual.
        this.cancelStreamGiveUp()
        this.applyFailure('STREAMING', pending.error, pending.occurredAt)
        return
      }
      this.applyFailure(source, error, occurredAt)
      return
    }
    this.cancelStreamGiveUp()
    // The ignore rules are not checked again when the wait ends: the stream
    // gives up first and starts the polling fallback right after, so a check
    // then would always drop the give-up.
    const timer = setTimeout(() => {
      this.pendingStreamGiveUp = undefined
      this.applyFailure(source, error, occurredAt)
    }, STREAM_GIVE_UP_WAIT_MILLIS)
    this.pendingStreamGiveUp = { timer, error, occurredAt }
  }

  markStreamNotWorking(): void {
    this.streamWorking = false
  }

  // Stream bytes prove the values are current only while the stream works:
  // the server would send a patch if a flag changed.
  reportStreamingAlive(): void {
    if (this.isDestroyed() || !this.streamWorking) return
    this.updateLastSyncedAt()
  }

  setPollingFallbackActive(active: boolean): void {
    this.pollingFallbackActive = active
  }

  private isDestroyed(): boolean {
    return this.status.state === 'DESTROYED'
  }

  // While one path still updates flag values, a failure on the other path says
  // nothing about the app's flags. Counting it would move the state back and
  // forth each time the failing path retries.
  private isIgnoredFailure(source: BKTEvaluationSyncSource): boolean {
    return source === 'STREAMING'
      ? this.pollingFallbackActive
      : this.streamWorking
  }

  // occurredAt is when the flow reported the failure. For a stream give-up it
  // is the give-up time, so it is STREAM_GIVE_UP_WAIT_MILLIS before changedAt
  // (the time the state changed to FAILING, after the wait).
  private applyFailure(
    source: BKTEvaluationSyncSource,
    error: BKTException,
    occurredAt: number,
  ): void {
    // Before init finishes, INITIALIZING keeps its state. FAILING stays
    // FAILING, but listeners still get the new error.
    const state = this.status.state
    if (state === 'SYNCED' || (state === 'INITIALIZING' && this.initFinished)) {
      this.setState('FAILING')
    }
    this.setLastError(source, error, occurredAt)
    this.notifyListeners()
  }

  private cancelStreamGiveUp(): void {
    clearTimeout(this.pendingStreamGiveUp?.timer)
    this.pendingStreamGiveUp = undefined
  }

  private setState(state: BKTEvaluationSyncStatus['state']): void {
    this.status = Object.assign({}, this.status, {
      state,
      changedAt: this.clock.currentTimeMillis(),
    })
  }

  private setLastError(
    source: BKTEvaluationSyncSource,
    error: BKTException,
    occurredAt: number,
  ): void {
    this.status = Object.assign({}, this.status, {
      lastError: {
        cause: error,
        occurredAt,
        source,
      },
    })
  }

  private updateLastSyncedAt(): void {
    this.status = Object.assign({}, this.status, {
      lastSyncedAt: this.clock.currentTimeMillis(),
    })
  }

  private notifyListeners(): void {
    Object.entries(this.listeners).forEach(([id, listener]) => {
      // A listener can remove another listener, or destroy the client (which
      // removes all of them). A removed listener must not be called.
      if (this.listeners[id] !== listener) return
      try {
        listener(this.getStatus())
      } catch (e) {
        // App code must not be able to break polling or the stream.
        console.error('EvaluationSyncStatusTracker: a listener threw', e)
      }
    })
  }
}

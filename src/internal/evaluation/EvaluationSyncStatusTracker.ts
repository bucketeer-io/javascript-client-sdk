import {
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
  // stays INITIALIZING until a sync succeeds, or the poller reports a failure
  // after its retries. error: an init error not related to the request, which
  // sets FAILING at once (only while the state is still INITIALIZING).
  finishInitializing(succeeded: boolean, error?: BKTException): void
  markDestroyed(): void
}

// Holds the one sync status of the client and calls its listeners.
//
// - INITIALIZING lasts until the first sync result. A success sets SYNCED at
//   once. A failure reported before init finishes updates lastError only.
// - Only polling reports failures, after its retries. A reported failure sets
//   FAILING. The stream reports only successes (see StreamingSyncReporter).
// - An init error not related to the request sets FAILING at once, through
//   finishInitializing().
// - Listeners are called on every state change and on every failure that is
//   not ignored (see reportFailure()).
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
  // true from a stream put/patch until the stream is marked as not working.
  private streamWorking = false
  // Lets a failure reported after init move INITIALIZING to FAILING.
  private initFinished = false

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
    this.setLastError(error, this.clock.currentTimeMillis())
    this.notifyListeners()
  }

  markDestroyed(): void {
    if (this.isDestroyed()) return
    this.setState('DESTROYED')
    this.notifyListeners()
    this.clearListeners()
  }

  reportSuccess(): void {
    if (this.isDestroyed()) return
    // Already SYNCED: only lastSyncedAt moves, with no listener call.
    const changed = this.status.state !== 'SYNCED'
    if (changed) this.setState('SYNCED')
    this.updateLastSyncedAt()
    if (changed) this.notifyListeners()
  }

  markStreamWorking(): void {
    this.streamWorking = true
  }

  reportFailure(error: BKTException): void {
    if (this.isDestroyed()) return
    // While the stream works, it keeps the flag values current, so a polling
    // failure says nothing about them. This happens when a fallback poll
    // fails after the stream came back.
    if (this.streamWorking) return
    this.applyFailure(error, this.clock.currentTimeMillis())
  }

  markStreamNotWorking(): void {
    this.streamWorking = false
  }

  // The rule: while the stream is healthy (a valid put or patch arrived, and
  // no error since), any stream bytes (data or a heartbeat) move
  // lastSyncedAt: the server would send a patch if a flag changed.
  // Cases:
  // - A heartbeat after a put: moves it.
  // - Bytes after a failed try or a server error event: do not move it
  //   (markStreamNotWorking()), until the next put or patch.
  // - The first bytes of a new connection, after a healthy one ended with no
  //   error (a server restart, or the reconnect of updateUserAttributes()):
  //   they move it, even if this connection then sends only an error event.
  //   The stream counts as healthy until that error arrives, a moment later.
  //   This is on purpose: lastSyncedAt is not meant to be exact to the second.
  reportStreamingAlive(): void {
    if (this.isDestroyed() || !this.streamWorking) return
    this.updateLastSyncedAt()
  }

  private isDestroyed(): boolean {
    return this.status.state === 'DESTROYED'
  }

  private applyFailure(error: BKTException, occurredAt: number): void {
    // Before init finishes, INITIALIZING keeps its state. FAILING stays
    // FAILING, but listeners still get the new error.
    const state = this.status.state
    if (state === 'SYNCED' || (state === 'INITIALIZING' && this.initFinished)) {
      this.setState('FAILING')
    }
    this.setLastError(error, occurredAt)
    this.notifyListeners()
  }

  private setState(state: BKTEvaluationSyncStatus['state']): void {
    this.status = Object.assign({}, this.status, {
      state,
      changedAt: this.clock.currentTimeMillis(),
    })
  }

  private setLastError(error: BKTException, occurredAt: number): void {
    this.status = Object.assign({}, this.status, {
      lastError: {
        cause: error,
        occurredAt,
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

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
  // Does nothing unless the state is still INITIALIZING.
  finishInitializing(succeeded: boolean): void
  markDestroyed(): void
}

// Holds the one sync status of the client and calls its listeners.
//
// - INITIALIZING lasts until initializeBKTClient() finishes. Errors during
//   init update lastError only. A success sets SYNCED at once.
// - After init, a success sets SYNCED and a failure sets FAILING.
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
  // true from a stream put/patch until the next stream failure.
  private streamWorking = false
  private pollingFallbackActive = false

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

  finishInitializing(succeeded: boolean): void {
    if (succeeded || this.status.state !== 'INITIALIZING') return
    this.setState('FAILING')
    this.notifyListeners()
  }

  markDestroyed(): void {
    if (this.isDestroyed()) return
    this.setState('DESTROYED')
    this.notifyListeners()
    this.clearListeners()
  }

  reportSuccess(source: BKTEvaluationSyncSource): void {
    if (this.isDestroyed()) return
    if (source === 'STREAMING') this.streamWorking = true

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

    // INITIALIZING keeps its state: finishInitializing() decides it. FAILING
    // stays FAILING, but listeners still get the new error.
    if (this.status.state === 'SYNCED') this.setState('FAILING')
    this.status = Object.assign({}, this.status, {
      lastError: {
        cause: error,
        occurredAt: this.clock.currentTimeMillis(),
        source,
      },
    })
    this.notifyListeners()
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

  private setState(state: BKTEvaluationSyncStatus['state']): void {
    this.status = Object.assign({}, this.status, {
      state,
      changedAt: this.clock.currentTimeMillis(),
    })
  }

  private updateLastSyncedAt(): void {
    this.status = Object.assign({}, this.status, {
      lastSyncedAt: this.clock.currentTimeMillis(),
    })
  }

  private notifyListeners(): void {
    Object.values(this.listeners).forEach((listener) => {
      try {
        listener(this.getStatus())
      } catch (e) {
        // App code must not be able to break polling or the stream.
        console.error('EvaluationSyncStatusTracker: a listener threw', e)
      }
    })
  }
}

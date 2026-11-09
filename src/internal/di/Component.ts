import { BKTConfig } from '../../BKTConfig'
import { EvaluationInteractor } from '../evaluation/EvaluationInteractor'
import {
  EvaluationSyncStatusTracker,
  EvaluationSyncStatusTrackerImpl,
} from '../evaluation/EvaluationSyncStatusTracker'
import { StreamingSyncReporter } from '../evaluation/StreamingSyncReporter'
import { EventInteractor } from '../event/EventInteractor'
import { UserHolder } from '../UserHolder'
import { DataModule } from './DataModule'
import { InteractorModule } from './InteractorModule'
import { PlatformModule } from './PlatformModule'

export interface Component {
  config(): BKTConfig
  userHolder(): UserHolder
  evaluationInteractor(): EvaluationInteractor
  eventInteractor(): EventInteractor
  // For BKTClient: read the sync status, manage its listeners, init and destroy.
  evaluationSyncStatusTracker(): EvaluationSyncStatusTracker
  // For StreamingTask: report the stream facts only it knows.
  streamingSyncReporter(): StreamingSyncReporter
}

export class DefaultComponent implements Component {
  private _evaluationInteractor?: EvaluationInteractor
  private _eventInteractor?: EventInteractor
  private _syncStatusTracker?: EvaluationSyncStatusTrackerImpl

  constructor(
    public platformModule: PlatformModule,
    public dataModule: DataModule,
    public interactorModule: InteractorModule,
  ) {}

  config(): BKTConfig {
    return this.dataModule.config()
  }

  userHolder(): UserHolder {
    return this.dataModule.userHolder()
  }

  evaluationInteractor(): EvaluationInteractor {
    return (this._evaluationInteractor ??=
      this.interactorModule.evaluationInteractor(
        this.dataModule.config().featureTag,
        this.dataModule.apiClient(),
        this.dataModule.evaluationStorage(),
        this.platformModule.idGenerator(),
        this.syncStatusTrackerImpl(),
      ))
  }

  eventInteractor(): EventInteractor {
    return (this._eventInteractor ??= this.interactorModule.eventInteractor(
      this.dataModule.config().eventsMaxQueueSize,
      this.dataModule.apiClient(),
      this.dataModule.eventStorage(),
      this.platformModule.idGenerator(),
      this.dataModule.clock(),
      this.dataModule.config().appVersion,
      this.dataModule.config().userAgent,
      this.dataModule.config().sourceId,
      this.dataModule.config().sdkVersion,
    ))
  }

  evaluationSyncStatusTracker(): EvaluationSyncStatusTracker {
    return this.syncStatusTrackerImpl()
  }

  streamingSyncReporter(): StreamingSyncReporter {
    return this.syncStatusTrackerImpl()
  }

  // One object, given out to each caller as only the interface it uses.
  private syncStatusTrackerImpl(): EvaluationSyncStatusTrackerImpl {
    return (this._syncStatusTracker ??=
      this.interactorModule.evaluationSyncStatusTracker(
        this.dataModule.clock(),
        this.platformModule.idGenerator(),
      ))
  }
}

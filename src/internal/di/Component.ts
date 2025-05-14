import { BKTConfig } from '../../BKTConfig'
import { EvaluationInteractor } from '../evaluation/EvaluationInteractor'
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
}

export class DefaultComponent implements Component {
  private _evaluationInteractor?: EvaluationInteractor
  private _eventInteractor?: EventInteractor

  constructor(
    public platformModule: PlatformModule,
    public dataModule: DataModule,
    public interactorModule: InteractorModule,
  ) { }

  config(): BKTConfig {
    return this.dataModule.config()
  }

  userHolder(): UserHolder {
    return this.dataModule.userHolder()
  }

  evaluationInteractor(): EvaluationInteractor {
    if (!this._evaluationInteractor) {
      this._evaluationInteractor = this.interactorModule.evaluationInteractor(
        this.dataModule.config().featureTag,
        this.dataModule.apiClient(),
        this.dataModule.evaluationStorage(),
        this.platformModule.idGenerator(),
        this.dataModule.config().sourceId,
        this.dataModule.config().sdkVersion,
      )
    }
    return this._evaluationInteractor
  }

  eventInteractor(): EventInteractor {
    if (!this._eventInteractor) {
      this._eventInteractor = this.interactorModule.eventInteractor(
        this.dataModule.config().eventsMaxQueueSize,
        this.dataModule.apiClient(),
        this.dataModule.eventStorage(),
        this.platformModule.idGenerator(),
        this.dataModule.clock(),
        this.dataModule.config().appVersion,
        this.dataModule.config().userAgent,
        this.dataModule.config().sourceId,
        this.dataModule.config().sdkVersion,
      )
    }
    return this._eventInteractor
  }
}

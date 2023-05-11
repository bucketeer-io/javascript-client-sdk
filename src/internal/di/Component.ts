import { BKTConfig } from '../../BKTConfig'
import { EvaluationInteractor } from '../evaluation/EvaluationInteractor'
import { EventInteractor } from '../event/EventInteractor'
import { UserHolder } from '../UserHolder'
import { DataModule } from './DataModule'
import { InteractorModule } from './InteractorModule'

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
    if (!this._evaluationInteractor) {
      this._evaluationInteractor = this.interactorModule.evaluationInteractor(
        this.dataModule.apiClient(),
        this.dataModule.evaluationStorage(),
        this.dataModule.idGenerator(),
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
        this.dataModule.idGenerator(),
        this.dataModule.clock(),
        this.dataModule.config().appVersion,
        this.dataModule.config().userAgent,
      )
    }
    return this._eventInteractor
  }
}

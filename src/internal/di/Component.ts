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
      this.dataModule.config().evaluationDedupWindowMillis,
    ))
  }
}

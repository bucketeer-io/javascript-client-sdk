import { BKTConfig } from '../../BKTConfig'
import { EvaluationInteractor } from '../evaluation/EvaluationInteractor'
import { UserHolder } from '../UserHolder'
import { DataModule } from './DataModule'
import { InteractorModule } from './InteractorModule'

export interface Component {
  config(): BKTConfig
  userHolder(): UserHolder
  evaluationInteractor(): EvaluationInteractor
}

export class DefaultComponent implements Component {
  private _evaluationInteractor?: EvaluationInteractor

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
        this.dataModule.idGenerator()
      )
    }
    return this._evaluationInteractor
  }
}

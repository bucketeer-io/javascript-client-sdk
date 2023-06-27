import { BKTConfig } from '../../BKTConfig'
import { Clock, DefaultClock } from '../Clock'
import {
  EvaluationStorage,
  EvaluationStorageImpl,
} from '../evaluation/EvaluationStorage'
import { EventStorage, EventStorageImpl } from '../event/EventStorage'
import { User } from '../model/User'
import { ApiClient, ApiClientImpl } from '../remote/ApiClient'
import { UserHolder } from '../UserHolder'

export class DataModule {
  private _userHolder: UserHolder
  private _config: BKTConfig
  protected _clock?: Clock
  private _apiClient?: ApiClient
  private _evaluationStorage?: EvaluationStorage
  private _eventStorage?: EventStorage

  constructor(user: User, config: BKTConfig) {
    this._config = config
    this._userHolder = new UserHolder(user)
  }

  config(): BKTConfig {
    return this._config
  }

  userHolder(): UserHolder {
    return this._userHolder
  }

  clock(): Clock {
    if (!this._clock) {
      this._clock = new DefaultClock()
    }
    return this._clock
  }

  apiClient(): ApiClient {
    if (!this._apiClient) {
      const config = this.config()
      this._apiClient = new ApiClientImpl(
        config.apiEndpoint,
        config.apiKey,
        config.featureTag,
        config.fetch,
      )
    }
    return this._apiClient
  }

  evaluationStorage(): EvaluationStorage {
    if (!this._evaluationStorage) {
      this._evaluationStorage = new EvaluationStorageImpl(
        this.userHolder().userId,
        this.config().storageFactory(
          `${this.config().storageKeyPrefix}_bkt_evaluations`,
        ),
      )
    }
    return this._evaluationStorage
  }

  eventStorage(): EventStorage {
    if (!this._eventStorage) {
      this._eventStorage = new EventStorageImpl(
        this.userHolder().userId,
        this.config().storageFactory(
          `${this.config().storageKeyPrefix}_bkt_events`,
        ),
      )
    }
    return this._eventStorage
  }
}

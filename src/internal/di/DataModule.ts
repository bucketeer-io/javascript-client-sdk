import { Clock, DefaultClock } from '../Clock'
import {
  EvaluationStorage,
  EvaluationStorageImpl,
} from '../evaluation/EvaluationStorage'
import { EventStorage, EventStorageImpl } from '../event/EventStorage'
import { InternalConfig } from '../InternalConfig'
import { User } from '../model/User'
import { ApiClient, ApiClientImpl } from '../remote/ApiClient'
import { UserHolder } from '../UserHolder'

export class DataModule {
  private _userHolder: UserHolder
  private _config: InternalConfig
  protected _clock?: Clock
  private _apiClient?: ApiClient
  private _evaluationStorage?: EvaluationStorage
  private _eventStorage?: EventStorage

  constructor(user: User, config: InternalConfig) {
    this._config = config
    this._userHolder = new UserHolder(user)
  }

  config(): InternalConfig {
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
        config.fetch,
        config.sourceId,
        config.sdkVersion,
      )
    }
    return this._apiClient
  }

  evaluationStorage(): EvaluationStorage {
    if (!this._evaluationStorage) {
      const config = this.config()
      this._evaluationStorage = new EvaluationStorageImpl(
        this.userHolder().userId,
        config.storageFactory(`${config.storageKeyPrefix}_bkt_evaluations`),
      )
    }
    return this._evaluationStorage
  }

  eventStorage(): EventStorage {
    if (!this._eventStorage) {
      const config = this.config()
      this._eventStorage = new EventStorageImpl(
        this.userHolder().userId,
        config.storageFactory(`${config.storageKeyPrefix}_bkt_events`),
      )
    }
    return this._eventStorage
  }
}

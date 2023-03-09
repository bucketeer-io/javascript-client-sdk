import { BKTConfig } from '../../BKTConfig'
import { Clock, DefaultClock } from '../Clock'
import {
  EvaluationStorage,
  EvaluationStorageImpl,
} from '../evaluation/EvaluationStorage'
import { EventStorage, EventStorageImpl } from '../event/EventStorage'
import { DefaultIdGenerator, IdGenerator } from '../IdGenerator'
import { User } from '../model/User'
import { ApiClient, ApiClientImpl } from '../remote/ApiClient'
import { DefaultStorage } from '../storege'
import { UserHolder } from '../UserHolder'

export class DataModule {
  private _userHolder: UserHolder
  private _config: BKTConfig
  protected _idGenerator?: IdGenerator
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

  idGenerator(): IdGenerator {
    if (!this._idGenerator) {
      this._idGenerator = new DefaultIdGenerator()
    }
    return this._idGenerator
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
        new DefaultStorage(`${this.config().storageKeyPrefix}_bkt_evaluations`),
      )
    }
    return this._evaluationStorage
  }

  eventStorage(): EventStorage {
    if (!this._eventStorage) {
      this._eventStorage = new EventStorageImpl(
        this.userHolder().userId,
        new DefaultStorage(`${this.config().storageKeyPrefix}_bkt_events`),
      )
    }
    return this._eventStorage
  }
}

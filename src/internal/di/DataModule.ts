import { BKTConfig } from '../../BKTConfig'
import { EvaluationStorage, EvaluationStorageImpl } from '../evaluation/EvaluationStorage'
import { DefaultIdGenerator, IdGenerator } from '../IdGenerator'
import { User } from '../model/User'
import { ApiClient, ApiClientImpl } from '../remote/ApiClient'
import { DefaultStorage } from '../storege'
import { UserHolder } from '../UserHolder'

export class DataModule {
  private _userHolder: UserHolder
  private _config: BKTConfig
  private _idGenerator?: IdGenerator
  private _apiClient?: ApiClient
  private _evaluationSTorage?: EvaluationStorage

  constructor(
    user: User,
    config: BKTConfig,
  ) {
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
    if (!this._evaluationSTorage) {
      this._evaluationSTorage = new EvaluationStorageImpl(
        this.userHolder().userId,
        new DefaultStorage(`${this.config().storageKeyPrefix}_bkt_evaluations`)
      )
    }
    return this._evaluationSTorage
  }
}

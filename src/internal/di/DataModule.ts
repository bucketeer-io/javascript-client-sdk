import { Clock, DefaultClock } from '../Clock'
import {
  EvaluationStorage,
  EvaluationStorageImpl,
} from '../evaluation/EvaluationStorage'
import { EventStorage, EventStorageImpl } from '../event/EventStorage'
import { createSafeEventStorage } from '../event/ThreadSafeEventStorage'
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
      const userId = this.userHolder().userId
      const storageKey = `${config.storageKeyPrefix}_bkt_events`

      // Check if cross-tab safety is enabled (could be a config option)
      const enableCrossTabSafety = this.shouldEnableCrossTabSafety()

      if (enableCrossTabSafety) {
        // Use thread-safe event storage
        this._eventStorage = createSafeEventStorage(
          userId,
          config.storageFactory(storageKey),
          config.storageFactory,
          {
            timeout: 3000, // 3 seconds timeout
            lockCheckInterval: 50, // Check every 50ms
            maxRetries: 60, // Max 60 retries (3 seconds total)
          },
        )
      } else {
        // Use regular event storage
        this._eventStorage = new EventStorageImpl(
          userId,
          config.storageFactory(storageKey),
        )
      }
    }
    return this._eventStorage
  }

  /**
   * Determines if cross-tab safety should be enabled.
   * This can be configured or automatically detected.
   */
  private shouldEnableCrossTabSafety(): boolean {
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return false
    }

    // Could be made configurable through BKTConfig in the future
    // For now, enable it by default in browser environments
    return true
  }
}

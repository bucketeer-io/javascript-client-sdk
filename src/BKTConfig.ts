import { IllegalArgumentException } from './BKTExceptions'
import { BKTStorage, createBKTStorage } from './BKTStorage'
import { FetchLike } from './internal/remote/fetch'
import { SDK_VERSION } from './internal/version'

const MINIMUM_FLUSH_INTERVAL_MILLIS = 60_000 // 60 seconds
const DEFAULT_FLUSH_INTERVAL_MILLIS = 60_000 // 60 seconds
const DEFAULT_MAX_QUEUE_SIZE = 50
const MINIMUM_POLLING_INTERVAL_MILLIS = 60_000 // 60 seconds
const DEFAULT_POLLING_INTERVAL_MILLIS = 600_000 // 10 minutes

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url)
    return true
  } catch (err) {
    return false
  }
}

interface RawBKTConfig {
  apiKey: string
  apiEndpoint: string
  featureTag?: string
  eventsFlushInterval?: number
  eventsMaxQueueSize?: number
  pollingInterval?: number
  appVersion: string
  storageKeyPrefix?: string
  userAgent?: string
  fetch?: FetchLike
  storageFactory?: <T>(key: string) => BKTStorage<T>
}

export interface BKTConfig extends RawBKTConfig {
  featureTag: string
  eventsFlushInterval: number
  eventsMaxQueueSize: number
  pollingInterval: number
  userAgent: string
  fetch: FetchLike
  storageFactory: <T>(key: string) => BKTStorage<T>
}

const defaultUserAgent = () => {
  if (typeof window === 'undefined') {
    return `Bucketeer JavaScript SDK(${SDK_VERSION})`
  } else {
    return window.navigator.userAgent
  }
}

export const defineBKTConfig = (config: RawBKTConfig): BKTConfig => {
  const userAgent = defaultUserAgent()

  const result: BKTConfig = {
    featureTag: '',
    eventsFlushInterval: MINIMUM_FLUSH_INTERVAL_MILLIS,
    eventsMaxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
    pollingInterval: DEFAULT_POLLING_INTERVAL_MILLIS,
    storageKeyPrefix: '',
    userAgent,
    fetch,
    storageFactory: createBKTStorage,
    ...config,
  }

  if (!result.apiKey) throw new IllegalArgumentException('apiKey is required')
  if (!result.apiEndpoint)
    throw new IllegalArgumentException('apiEndpoint is required')
  if (!isValidUrl(result.apiEndpoint))
    throw new IllegalArgumentException('apiEndpoint is invalid')
  if (!result.appVersion)
    throw new IllegalArgumentException('appVersion is required')
  if (!result.fetch) throw new IllegalArgumentException('fetch is required')

  if (result.pollingInterval < MINIMUM_POLLING_INTERVAL_MILLIS) {
    result.pollingInterval = DEFAULT_POLLING_INTERVAL_MILLIS
  }

  if (result.eventsFlushInterval < MINIMUM_FLUSH_INTERVAL_MILLIS) {
    result.eventsFlushInterval = DEFAULT_FLUSH_INTERVAL_MILLIS
  }

  if (!result.userAgent) {
    result.userAgent = userAgent
  }

  return {
    ...result,
  }
}

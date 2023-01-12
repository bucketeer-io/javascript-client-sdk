import { FetchLike } from './internal/remote/fetch'

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
  featureTag: string
  eventsFlushInterval?: number
  eventsMaxBatchQueueCount?: number
  pollingInterval?: number
  appVersion: string
  storageKeyPrefix?: string
  fetch: FetchLike
}

export interface BKTConfig extends RawBKTConfig {
  eventsFlushInterval: number
  eventsMaxBatchQueueCount: number
  pollingInterval: number
}

export const defineBKTConfig = (config: RawBKTConfig): BKTConfig => {
  const result: BKTConfig = {
    eventsFlushInterval: MINIMUM_FLUSH_INTERVAL_MILLIS,
    eventsMaxBatchQueueCount: DEFAULT_MAX_QUEUE_SIZE,
    pollingInterval: DEFAULT_POLLING_INTERVAL_MILLIS,
    storageKeyPrefix: '',
    ...config,
  }

  if (!result.apiKey) throw new Error('apiKey is required')
  if (!result.apiEndpoint) throw new Error('apiEndpoint is required')
  if (!isValidUrl(result.apiEndpoint))
    throw new Error('apiEndpoint is invalid')
  if (!result.featureTag) throw new Error('featureTag is required')
  if (!result.appVersion) throw new Error('appVersion is required')

  if (result.pollingInterval < MINIMUM_POLLING_INTERVAL_MILLIS) {
    result.pollingInterval = DEFAULT_POLLING_INTERVAL_MILLIS
  }

  if (result.eventsFlushInterval < MINIMUM_FLUSH_INTERVAL_MILLIS) {
    result.eventsFlushInterval = DEFAULT_FLUSH_INTERVAL_MILLIS
  }

  return {
    ...result,
  }
}

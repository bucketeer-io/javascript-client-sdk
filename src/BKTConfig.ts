import { IllegalArgumentException } from './BKTExceptions'
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
  eventsMaxQueueSize?: number
  pollingInterval?: number
  appVersion: string
  storageKeyPrefix?: string
  userAgent?: string
  fetch?: FetchLike
}

export interface BKTConfig extends RawBKTConfig {
  eventsFlushInterval: number
  eventsMaxQueueSize: number
  pollingInterval: number
  userAgent: string
  fetch: FetchLike
}

export const defineBKTConfig = (config: RawBKTConfig): BKTConfig => {
  const result: BKTConfig = {
    eventsFlushInterval: MINIMUM_FLUSH_INTERVAL_MILLIS,
    eventsMaxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
    pollingInterval: DEFAULT_POLLING_INTERVAL_MILLIS,
    storageKeyPrefix: '',
    userAgent: window.navigator.userAgent,
    fetch: window.fetch,
    ...config,
  }

  if (!result.apiKey) throw new IllegalArgumentException('apiKey is required')
  if (!result.apiEndpoint)
    throw new IllegalArgumentException('apiEndpoint is required')
  if (!isValidUrl(result.apiEndpoint))
    throw new IllegalArgumentException('apiEndpoint is invalid')
  if (!result.featureTag)
    throw new IllegalArgumentException('featureTag is required')
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
    result.userAgent = window.navigator.userAgent
  }

  return {
    ...result,
  }
}

import { IllegalArgumentException } from './BKTExceptions'
import { BKTStorage, createBKTStorage } from './BKTStorage'
import {
  InternalConfig,
  resolveSDKVersion,
  resolveSourceId,
} from './internal/InternalConfig'
import { IdGenerator } from './internal/IdGenerator'
import { FetchLike } from './internal/remote/fetch'
import { SDK_VERSION } from './internal/version'

const MINIMUM_FLUSH_INTERVAL_MILLIS = 10_000 // 10 seconds
const DEFAULT_FLUSH_INTERVAL_MILLIS = 10_000 // 10 seconds
const DEFAULT_MAX_QUEUE_SIZE = 50
const MINIMUM_POLLING_INTERVAL_MILLIS = 60_000 // 60 seconds
const DEFAULT_POLLING_INTERVAL_MILLIS = 600_000 // 10 minutes
const MINIMUM_EVALUATION_DEDUP_WINDOW_MILLIS = 10_000 // 10 seconds
const DEFAULT_EVALUATION_DEDUP_WINDOW_MILLIS = 30_000 // 30 seconds

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export interface RawBKTConfig {
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

  // Enable automatic event flushing on page lifecycle events (pagehide, visibilitychange).
  // This helps prevent data loss when users navigate away or switch tabs.
  // Default: true
  // Set to false if you want to manually control event flushing.
  enableAutoPageLifecycleFlush?: boolean

  // Evaluation event deduplication window in milliseconds.
  // Same user+flag+variation within this window = only 1 event created.
  // Minimum: 10000 (10 seconds - covers heavy apps with progressive rendering)
  // Default: 30000 (30 seconds - recommended for most use cases)
  // Conservative: 60000 (1 minute - for pages with infrequent flag evaluations)
  // Values below minimum will be automatically adjusted to the default.
  evaluationDedupWindowMillis?: number

  // Use wrapperSdkVersion to set the SDK version explicitly.
  // IMPORTANT: This option is intended for internal use only.
  // It should NOT be set by developers directly integrating this SDK.
  // Use this option ONLY when another SDK acts as a proxy and wraps this native SDK.
  // In such cases, set this value to the version of the proxy SDK.
  wrapperSdkVersion?: string

  // Use wrapperSdkSourceId to set the source ID explicitly.
  // IMPORTANT: This option is intended for internal use only.
  // It should NOT be set by developers directly integrating this SDK.
  // Use this option ONLY when another SDK acts as a proxy and wraps this native SDK.
  // In such cases, set this value to the sourceID of the proxy SDK.
  // The sourceID is used to identify the origin of the request.
  wrapperSdkSourceId?: number
  idGenerator?: IdGenerator
}

export interface BKTConfig extends RawBKTConfig {
  featureTag: string
  eventsFlushInterval: number
  eventsMaxQueueSize: number
  pollingInterval: number
  userAgent: string
  fetch: FetchLike
  storageFactory: <T>(key: string) => BKTStorage<T>
  enableAutoPageLifecycleFlush: boolean
  evaluationDedupWindowMillis: number
}

const defaultUserAgent = () => {
  if (
    typeof window !== 'undefined' &&
    window.navigator &&
    typeof window.navigator.userAgent === 'string'
  ) {
    return window.navigator.userAgent
  } else {
    return `Bucketeer JavaScript SDK(${SDK_VERSION})`
  }
}

export const defineBKTConfig = (config: RawBKTConfig): BKTConfig => {
  const userAgent = defaultUserAgent()

  const result: BKTConfig = {
    apiKey: config.apiKey,
    apiEndpoint: config.apiEndpoint,
    appVersion: config.appVersion,
    featureTag: config.featureTag ?? '',
    eventsFlushInterval:
      config.eventsFlushInterval ?? MINIMUM_FLUSH_INTERVAL_MILLIS,
    eventsMaxQueueSize: config.eventsMaxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
    pollingInterval: config.pollingInterval ?? DEFAULT_POLLING_INTERVAL_MILLIS,
    storageKeyPrefix: config.storageKeyPrefix ?? '',
    userAgent: config.userAgent ?? userAgent,
    fetch: config.fetch ?? globalThis.fetch,
    storageFactory: config.storageFactory ?? createBKTStorage,
    enableAutoPageLifecycleFlush: config.enableAutoPageLifecycleFlush ?? true,
    evaluationDedupWindowMillis:
      config.evaluationDedupWindowMillis ??
      DEFAULT_EVALUATION_DEDUP_WINDOW_MILLIS,
  }

  // Advanced properties: only included when explicitly set (not undefined)
  // to prevent overriding internal defaults or leaking undefined values
  if (config.wrapperSdkVersion !== undefined) {
    result.wrapperSdkVersion = config.wrapperSdkVersion
  }
  if (config.wrapperSdkSourceId !== undefined) {
    result.wrapperSdkSourceId = config.wrapperSdkSourceId
  }
  if (config.idGenerator !== undefined) {
    result.idGenerator = config.idGenerator
  }

  // Validate required properties
  if (!result.apiKey) throw new IllegalArgumentException('apiKey is required')
  if (!result.apiEndpoint)
    throw new IllegalArgumentException('apiEndpoint is required')
  if (!isValidUrl(result.apiEndpoint))
    throw new IllegalArgumentException('apiEndpoint is invalid')
  if (!result.appVersion)
    throw new IllegalArgumentException('appVersion is required')

  if (typeof result.fetch !== 'function') {
    throw new IllegalArgumentException(
      'fetch is required: no fetch implementation was provided or no global fetch is available. ' +
        'Please provide a fetch implementation in the config (e.g., node-fetch in Node.js environments).',
    )
  }

  // Special handling for userAgent: empty string should use default
  if (!result.userAgent) {
    result.userAgent = userAgent
  }

  if (result.pollingInterval < MINIMUM_POLLING_INTERVAL_MILLIS) {
    result.pollingInterval = DEFAULT_POLLING_INTERVAL_MILLIS
  }

  if (result.eventsFlushInterval < MINIMUM_FLUSH_INTERVAL_MILLIS) {
    result.eventsFlushInterval = DEFAULT_FLUSH_INTERVAL_MILLIS
  }

  if (
    result.evaluationDedupWindowMillis < MINIMUM_EVALUATION_DEDUP_WINDOW_MILLIS
  ) {
    result.evaluationDedupWindowMillis = DEFAULT_EVALUATION_DEDUP_WINDOW_MILLIS
  }

  // Resolve SDK version and source Id without exposing SourceId to outside
  const sourceId = resolveSourceId(result)
  const sdkVersion = resolveSDKVersion(result, sourceId)
  const internalConfig = {
    ...result,
    sourceId,
    sdkVersion,
  } satisfies InternalConfig
  return internalConfig
}

import { BKTClient } from '../BKTClient'

const KEY = 'BKTCLIENT_INSTANCE'
const CLEANUP_KEY = 'BKTCLIENT_PAGE_LIFECYCLE_CLEANUP'
const _instance: Map<string, BKTClient> = new Map()
const _cleanup: Map<string, () => void> = new Map()

export const getInstance = (): BKTClient | null => {
  return _instance.get(KEY) ?? null
}

export const setInstance = (client: BKTClient) => {
  _instance.set(KEY, client)
}

export const clearInstance = () => {
  _instance.delete(KEY)
}

export const setPageLifecycleCleanup = (cleanup: () => void) => {
  _cleanup.set(CLEANUP_KEY, cleanup)
}

export const getPageLifecycleCleanup = (): (() => void) | null => {
  return _cleanup.get(CLEANUP_KEY) ?? null
}

export const clearPageLifecycleCleanup = () => {
  const cleanup = _cleanup.get(CLEANUP_KEY)
  if (cleanup) {
    cleanup()
    _cleanup.delete(CLEANUP_KEY)
  }
}

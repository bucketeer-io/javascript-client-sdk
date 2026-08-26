import { initializeBKTClientInternal, getBKTClient } from './BKTClient'
import { BKTConfig } from './BKTConfig'
import { BKTUser } from './BKTUser'
import { Component, DefaultComponent } from './internal/di/Component'
import { DataModule } from './internal/di/DataModule'
import { InteractorModule } from './internal/di/InteractorModule'
import { BrowserPlatformModule } from './internal/di/PlatformModule.browser'
import { requiredInternalConfig } from './internal/InternalConfig'
import { User } from './internal/model/User'
import { toUser } from './internal/UserHolder'
import { setupPageLifecycleListeners } from './utils/pageLifecycle'
import { setPageLifecycleCleanup } from './internal/instance'

export type { BKTConfig, RawBKTConfig } from './BKTConfig'
export { defineBKTConfig } from './BKTConfig'
export type { BKTUser } from './BKTUser'
export { defineBKTUser } from './BKTUser'
export type { BKTClient } from './BKTClient'
export { getBKTClient, destroyBKTClient } from './BKTClient'
export type {
  BKTStorage,
  BrowserLocalStorage,
  InMemoryStorage,
} from './BKTStorage'
export type {
  BKTValue,
  BKTJsonArray,
  BKTJsonObject,
  BKTJsonPrimitive,
} from './BKTValue'
export type { BKTEvaluationDetails } from './BKTEvaluationDetails'
export {
  setupPageLifecycleListeners,
  supportsSendBeacon,
} from './utils/pageLifecycle'
export type { FlushCallback } from './utils/pageLifecycle'

const createBrowserComponent = (config: BKTConfig, user: User): Component => {
  return new DefaultComponent(
    new BrowserPlatformModule(),
    new DataModule(user, requiredInternalConfig(config)),
    new InteractorModule(),
  )
}

/**
 * Page lifecycle event flush handler.
 * Called when page is hidden/unloaded to flush pending events.
 */
export const onPageLifecycleFlush = async (): Promise<void> => {
  try {
    await getBKTClient()?.flush()
  } catch (error) {
    // Silent failure - flush is best effort on page unload
    console.warn('[Bucketeer] Failed to flush events on page lifecycle:', error)
  }
}

export const initializeBKTClient = async (
  config: BKTConfig,
  user: BKTUser,
  timeoutMillis = 5_000,
): Promise<void> => {
  const component = createBrowserComponent(config, toUser(user))

  // Capture the client this call is responsible for *before* awaiting.
  // initializeBKTClientInternal runs synchronously up to setInstance() (or
  // short-circuits because a client already exists) before it ever returns
  // a promise, so getBKTClient() here already reflects the right instance
  // for this call.
  const initPromise = initializeBKTClientInternal(component, timeoutMillis)
  const client = getBKTClient()
  await initPromise

  // Auto-setup page lifecycle listeners if enabled, and only if the client
  // this call registered is still the current one after the await. A plain
  // non-null check on getBKTClient() is not enough: while this call was
  // pending, the client could have been destroyed and a different
  // initializeBKTClient() call could have created and finished initializing
  // its own client in the meantime. getBKTClient() would then be non-null
  // (that other call's client) even though this call's client is gone, and
  // we must not wire listeners -- or override what that other call decided
  // -- on its behalf.
  if (
    config.enableAutoPageLifecycleFlush &&
    typeof window !== 'undefined' &&
    client &&
    getBKTClient() === client
  ) {
    const cleanup = setupPageLifecycleListeners({
      onFlush: onPageLifecycleFlush,
    })
    // Store cleanup function to be called when client is destroyed
    setPageLifecycleCleanup(cleanup)
  }
}

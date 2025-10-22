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
  await initializeBKTClientInternal(component, timeoutMillis)

  // Auto-setup page lifecycle listeners if enabled
  if (config.enableAutoPageLifecycleFlush && typeof window !== 'undefined') {
    const cleanup = setupPageLifecycleListeners({
      onFlush: onPageLifecycleFlush,
    })
    // Store cleanup function to be called when client is destroyed
    setPageLifecycleCleanup(cleanup)
  }
}

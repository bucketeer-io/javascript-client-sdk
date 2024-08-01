import { initializeBKTClientInternal } from './BKTClient'
import { BKTConfig } from './BKTConfig'
import { BKTUser } from './BKTUser'
import { Component, DefaultComponent } from './internal/di/Component'
import { DataModule } from './internal/di/DataModule'
import { InteractorModule } from './internal/di/InteractorModule'
import { BrowserPlatformModule } from './internal/di/PlatformModule.browser'
import { User } from './internal/model/User'
import { toUser } from './internal/UserHolder'

export type { BKTConfig } from './BKTConfig'
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

const createBrowserComponent = (config: BKTConfig, user: User): Component => {
  return new DefaultComponent(
    new BrowserPlatformModule(),
    new DataModule(user, config),
    new InteractorModule(),
  )
}

export const initializeBKTClient = async (
  config: BKTConfig,
  user: BKTUser,
  timeoutMillis = 5_000,
): Promise<void> => {
  const component = createBrowserComponent(config, toUser(user))
  return initializeBKTClientInternal(component, timeoutMillis)
}

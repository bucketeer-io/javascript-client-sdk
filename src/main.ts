import { initializeBKTClientInternal } from './BKTClient'
import { BKTConfig } from './BKTConfig'
import { BKTUser } from './BKTUser'
import { Component, DefaultComponent } from './internal/di/Component'
import { DataModule } from './internal/di/DataModule'
import { InteractorModule } from './internal/di/InteractorModule'
import { BasePlatformModule } from './internal/di/PlatformModule'
import { NodePlatformModule } from './internal/di/PlatformModule.node'
import { User } from './internal/model/User'
import { toUser } from './internal/UserHolder'
import { requiredInternalConfig } from './internal/InternalConfig'

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

const createNodeComponent = (config: BKTConfig, user: User): Component => {
  return new DefaultComponent(
    config.idGenerator
      ? new BasePlatformModule({ idGenerator: config.idGenerator })
      : new NodePlatformModule(),
    new DataModule(user, requiredInternalConfig(config)),
    new InteractorModule(),
  )
}

export const initializeBKTClient = async (
  config: BKTConfig,
  user: BKTUser,
  timeoutMillis = 5_000,
): Promise<void> => {
  const component = createNodeComponent(config, toUser(user))
  return initializeBKTClientInternal(component, timeoutMillis)
}

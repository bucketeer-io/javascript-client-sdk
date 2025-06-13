import { initializeBKTClientInternal } from './BKTClient'
import { BKTConfig } from './BKTConfig'
import { BKTUser } from './BKTUser'
import { Component, DefaultComponent } from './internal/di/Component'
import { DataModule } from './internal/di/DataModule'
import { InteractorModule } from './internal/di/InteractorModule'
import { BasePlatformModule } from './internal/di/PlatformModule'
import { User } from './internal/model/User'
import { toUser } from './internal/UserHolder'
import { IdGenerator } from './internal/IdGenerator'
import { requiredInternalConfig } from './internal/InternalConfig'

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
export type {
  BKTValue,
  BKTJsonArray,
  BKTJsonObject,
  BKTJsonPrimitive,
} from './BKTValue'
export type { BKTEvaluationDetails } from './BKTEvaluationDetails'

// This endpoint is intended for use in React Native - Expo environments.
const createComponent = (config: BKTConfig, user: User): Component => {
  const idGenerator = requiredIdGenerator(config)
  return new DefaultComponent(
    new BasePlatformModule({ idGenerator }),
    new DataModule(user, requiredInternalConfig(config)),
    new InteractorModule(),
  )
}

export const initializeBKTClient = async (
  config: BKTConfig,
  user: BKTUser,
  timeoutMillis = 5_000,
): Promise<void> => {
  // idGenerator is required in the react native environment
  const component = createComponent(config, toUser(user))
  return initializeBKTClientInternal(component, timeoutMillis)
}

export function requiredIdGenerator(config: BKTConfig): IdGenerator {
  if (!config.idGenerator) {
    throw new Error('idGenerator is required in this environment')
  }
  return config.idGenerator
}

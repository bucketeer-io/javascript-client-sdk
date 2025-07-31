import { initializeBKTClientInternal } from './BKTClient'
import { BKTConfig, RawBKTConfig } from './BKTConfig'
import { BKTUser } from './BKTUser'
import { Component, DefaultComponent } from './internal/di/Component'
import { DataModule } from './internal/di/DataModule'
import { InteractorModule } from './internal/di/InteractorModule'
import { BasePlatformModule } from './internal/di/PlatformModule'
import { User } from './internal/model/User'
import { toUser } from './internal/UserHolder'
import { IdGenerator } from './internal/IdGenerator'
import { requiredInternalConfig } from './internal/InternalConfig'
import { defineBKTConfig as _defineBKTConfig } from './BKTConfig'

export type { BKTConfig, RawBKTConfig } from './BKTConfig'
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
  // Validates idGenerator exists and provides type safety for TypeScript
  // Even though defineBKTConfig already validates this, we need the type guard
  // to narrow the type from IdGenerator | undefined to IdGenerator
  const idGenerator = requiredIdGenerator(config)
  return new DefaultComponent(
    new BasePlatformModule({ idGenerator }),
    new DataModule(user, requiredInternalConfig(config)),
    new InteractorModule(),
  )
}

/**
 * React Native specific configuration factory that extends the base defineBKTConfig
 * to enforce React Native environment requirements.
 * 
 * This override ensures that idGenerator is provided and validated at configuration time,
 * providing immediate feedback to developers rather than failing later during client initialization.
 * 
 * @param config - Raw configuration object
 * @returns Validated BKTConfig with required React Native dependencies
 * @throws Error if idGenerator is missing (required in React Native environment)
 */
export const defineBKTConfig = (config: RawBKTConfig): BKTConfig => { 
  const bktConfig = _defineBKTConfig(config)
  requiredIdGenerator(bktConfig)
  return bktConfig
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

function requiredIdGenerator(config: BKTConfig): IdGenerator {
  if (!config.idGenerator) {
    throw new Error('idGenerator is required in this environment')
  }
  return config.idGenerator
}

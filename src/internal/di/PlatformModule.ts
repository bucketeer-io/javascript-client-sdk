import { IdGenerator } from '../IdGenerator'

export interface PlatformModule {
  idGenerator(): IdGenerator
}

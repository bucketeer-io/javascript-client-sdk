import { IdGenerator } from '../IdGenerator'
import { BrowserIdGenerator } from '../IdGenerator.browser'
import { PlatformModule } from './PlatformModule'

export class BrowserPlatformModule implements PlatformModule {
  protected _idGenerator?: IdGenerator

  idGenerator() {
    return (this._idGenerator ??= new BrowserIdGenerator())
  }
}

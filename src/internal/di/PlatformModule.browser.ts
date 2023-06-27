import { IdGenerator } from '../IdGenerator'
import { BrowserIdGenerator } from '../IdGenerator.browser'
import { PlatformModule } from './PlatformModule'

export class BrowserPlatformModule implements PlatformModule {
  protected _idGenerator?: IdGenerator

  idGenerator() {
    if (!this._idGenerator) {
      this._idGenerator = new BrowserIdGenerator()
    }
    return this._idGenerator
  }
}

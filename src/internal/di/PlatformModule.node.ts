import { IdGenerator } from '../IdGenerator'
import { NodeIdGenerator } from '../IdGenerator.node'
import { PlatformModule } from './PlatformModule'

export class NodePlatformModule implements PlatformModule {
  protected _idGenerator?: IdGenerator

  idGenerator() {
    if (!this._idGenerator) {
      this._idGenerator = new NodeIdGenerator()
    }
    return this._idGenerator
  }
}

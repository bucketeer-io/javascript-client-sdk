import { IdGenerator } from '../IdGenerator'

export interface PlatformModule {
  idGenerator(): IdGenerator
}

// BasePlatformModule serves as a base implementation of the PlatformModule interface.
// It relies on the BKTConfig to inject an instance of IdGenerator, which must be set before use.
export class BasePlatformModule implements PlatformModule {
  protected _idGenerator: IdGenerator

  constructor(params: { idGenerator: IdGenerator }) {
    this._idGenerator = params.idGenerator
  }

  idGenerator() {
    return this._idGenerator
  }
}

export interface IdGenerator {
  newId(): string
}

export class DefaultIdGenerator implements IdGenerator {
  newId(): string {
    return window.crypto.randomUUID()
  }
}

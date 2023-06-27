import { IdGenerator } from './IdGenerator'

export class BrowserIdGenerator implements IdGenerator {
  newId(): string {
    return crypto.randomUUID()
  }
}

import { randomUUID } from 'crypto'
import { IdGenerator } from './IdGenerator'

export class NodeIdGenerator implements IdGenerator {
  newId(): string {
    return randomUUID()
  }
}

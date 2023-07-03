import { Event } from '../model/Event'
import { BKTStorage } from '../../BKTStorage'

export interface EventEntity {
  userId: string
  events: Event[]
}

export interface EventStorage {
  getAll(): Event[]
  add(event: Event): void
  addAll(events: Event[]): void
  deleteByIds(ids: string[]): void
  clear(): void
}

export class EventStorageImpl implements EventStorage {
  constructor(public userId: string, public storage: BKTStorage<EventEntity>) {}

  add(event: Event): void {
    const entity = this.getInternal(this.userId)
    entity.events.push(event)
    this.storage.set(entity)
  }

  addAll(events: Event[]): void {
    const entity = this.getInternal(this.userId)
    entity.events.push(...events)
    this.storage.set(entity)
  }

  getAll(): Event[] {
    return this.getInternal(this.userId).events
  }

  deleteByIds(ids: string[]): void {
    const entity = this.getInternal(this.userId)
    entity.events = entity.events.filter((e) => !ids.includes(e.id))
    this.storage.set(entity)
  }

  clear(): void {
    this.storage.clear()
  }

  private getInternal(userId: string): EventEntity {
    const entity = this.storage.get()
    if (!entity || entity.userId !== userId) {
      // entity doesn't exist or userId is different
      return {
        userId,
        events: [],
      }
    }
    return entity
  }
}

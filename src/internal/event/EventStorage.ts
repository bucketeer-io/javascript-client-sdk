import { Event } from '../model/Event'
import { BKTStorage } from '../../BKTStorage'
import { Mutex } from 'async-mutex'
import { runWithMutex } from '../mutex'

export interface EventEntity {
  userId: string
  events: Event[]
}

export interface EventStorage {
  getAll(): Promise<Event[]>
  add(event: Event): Promise<void>
  addAll(events: Event[]): Promise<void>
  deleteByIds(ids: string[]): Promise<void>
  clear(): Promise<void>
}

export class EventStorageImpl implements EventStorage {
  constructor(
    public userId: string,
    public storage: BKTStorage<EventEntity>,
  ) { }

  private mutex = new Mutex()

  async add(event: Event): Promise<void> {
    return this.addAll([event])
  }

  async addAll(events: Event[]): Promise<void> {
    await runWithMutex(this.mutex, async () => {
      const entity = await this.getInternal(this.userId)
      entity.events.push(...events)
      await this.storage.set(entity)
    })
  }

  async getAll(): Promise<Event[]> {
    return runWithMutex(this.mutex, async () => {
      const events = (await this.getInternal(this.userId)).events
      return events
    })
  }

  async deleteByIds(ids: string[]): Promise<void> {
    await runWithMutex(this.mutex, async () => {
      const entity = await this.getInternal(this.userId)
      entity.events = entity.events.filter((e) => !ids.includes(e.id))
      await this.storage.set(entity)
    })
  }

  async clear(): Promise<void> {
    await runWithMutex(this.mutex, async () => {
      await this.storage.clear()
    })
  }

  private async getInternal(userId: string): Promise<EventEntity> {
    const entity = await this.storage.get()
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

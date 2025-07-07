import { Event } from '../model/Event'
import { BKTStorage } from '../../BKTStorage'
import { CrossTabMutex, CrossTabMutexOptions } from '../storage/CrossTabMutex'
import { EventStorage, EventStorageImpl, EventEntity } from './EventStorage'

interface MutexState {
  x: string | null
  y: string | null
  timestamp: number
}

/**
 * Thread-safe EventStorage implementation that prevents race conditions
 * when multiple tabs are accessing the same event storage.
 */
export class ThreadSafeEventStorage implements EventStorage {
  private readonly eventStorage: EventStorageImpl
  private readonly mutex: CrossTabMutex

  constructor(
    userId: string,
    storage: BKTStorage<EventEntity>,
    mutexStorage: BKTStorage<MutexState>,
    mutexOptions: CrossTabMutexOptions = {},
  ) {
    this.eventStorage = new EventStorageImpl(userId, storage)
    this.mutex = new CrossTabMutex(mutexStorage, mutexOptions)
  }

  // Synchronous methods for backward compatibility with existing interface
  add(event: Event): void {
    // For backward compatibility, we still provide synchronous methods
    // but they won't be cross-tab safe. Use addAsync for cross-tab safety.
    this.eventStorage.add(event)
  }

  addAll(events: Event[]): void {
    this.eventStorage.addAll(events)
  }

  getAll(): Event[] {
    return this.eventStorage.getAll()
  }

  deleteByIds(ids: string[]): void {
    this.eventStorage.deleteByIds(ids)
  }

  clear(): void {
    this.eventStorage.clear()
  }

  // Async methods for cross-tab safety
  async addAsync(event: Event): Promise<void> {
    return this.mutex.withLockSync(() => {
      this.eventStorage.add(event)
    })
  }

  async addAllAsync(events: Event[]): Promise<void> {
    return this.mutex.withLockSync(() => {
      this.eventStorage.addAll(events)
    })
  }

  async getAllAsync(): Promise<Event[]> {
    return this.mutex.withLockSync(() => {
      return this.eventStorage.getAll()
    })
  }

  async deleteByIdsAsync(ids: string[]): Promise<void> {
    return this.mutex.withLockSync(() => {
      this.eventStorage.deleteByIds(ids)
    })
  }

  async clearAsync(): Promise<void> {
    return this.mutex.withLockSync(() => {
      this.eventStorage.clear()
    })
  }
}

/**
 * Factory function to create a thread-safe event storage with fallback.
 * If mutex operations fail, it will fall back to the regular EventStorage.
 */
export function createSafeEventStorage(
  userId: string,
  storage: BKTStorage<EventEntity>,
  mutexStorageFactory: <T>(key: string) => BKTStorage<T>,
  mutexOptions: CrossTabMutexOptions = {},
): EventStorage {
  try {
    const mutexStorage = mutexStorageFactory<MutexState>(
      `${userId}_events_mutex`,
    )
    return new ThreadSafeEventStorage(
      userId,
      storage,
      mutexStorage,
      mutexOptions,
    )
  } catch (error) {
    // Fall back to regular EventStorage if mutex setup fails
    console.warn(
      'Failed to create thread-safe event storage, falling back to regular storage:',
      error,
    )
    return new EventStorageImpl(userId, storage)
  }
}

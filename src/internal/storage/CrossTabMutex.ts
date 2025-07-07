import { BKTStorage } from '../../BKTStorage'

interface MutexState {
  x: string | null
  y: string | null
  timestamp: number
}

export interface CrossTabMutexOptions {
  timeout?: number
  lockCheckInterval?: number
  maxRetries?: number
}

/**
 * Cross-tab mutex implementation using localStorage and Lamport's Fast Mutex algorithm.
 * This prevents race conditions when multiple tabs are accessing the same storage keys.
 */
export class CrossTabMutex {
  private readonly clientId: string
  private readonly timeout: number
  private readonly lockCheckInterval: number
  private readonly maxRetries: number
  private readonly storage: BKTStorage<MutexState>

  constructor(
    storage: BKTStorage<MutexState>,
    options: CrossTabMutexOptions = {},
  ) {
    this.clientId = this.generateClientId()
    this.timeout = options.timeout ?? 5000
    this.lockCheckInterval = options.lockCheckInterval ?? 50
    this.maxRetries = options.maxRetries ?? 100
    this.storage = storage
  }

  /**
   * Acquires an exclusive lock for the given operation.
   * Uses Lamport's Fast Mutex algorithm to ensure atomicity across tabs.
   */
  async lock(): Promise<void> {
    const startTime = Date.now()
    let retries = 0

    while (retries < this.maxRetries) {
      try {
        if (await this.tryAcquireLock()) {
          return
        }

        // Check for timeout
        if (Date.now() - startTime > this.timeout) {
          throw new Error(`Mutex lock timeout after ${this.timeout}ms`)
        }

        // Wait before retrying
        await this.sleep(this.lockCheckInterval)
        retries++
      } catch (error) {
        // Clean up any partial lock state on error
        await this.cleanup()
        throw error
      }
    }

    throw new Error(
      `Failed to acquire mutex lock after ${this.maxRetries} retries`,
    )
  }

  /**
   * Releases the lock held by this client.
   */
  async unlock(): Promise<void> {
    try {
      const state = this.storage.get()
      if (state && state.x === this.clientId) {
        // Clear the X lock if we own it
        this.storage.set({
          x: null,
          y: state.y,
          timestamp: Date.now(),
        })
      }
    } catch (error) {
      // Log error but don't throw - unlock should be best effort
      console.warn('Failed to release mutex lock:', error)
    }
  }

  /**
   * Executes a function with exclusive access across tabs.
   * Automatically handles lock acquisition and release.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.lock()
    try {
      return await fn()
    } finally {
      await this.unlock()
    }
  }

  /**
   * Executes a synchronous function with exclusive access across tabs.
   * Automatically handles lock acquisition and release.
   */
  async withLockSync<T>(fn: () => T): Promise<T> {
    await this.lock()
    try {
      return fn()
    } finally {
      await this.unlock()
    }
  }

  /**
   * Attempts to acquire the lock using Lamport's Fast Mutex algorithm.
   * Returns true if lock was acquired, false otherwise.
   */
  private async tryAcquireLock(): Promise<boolean> {
    const timestamp = Date.now()

    // Step 1: Write our client ID to X
    this.storage.set({
      x: this.clientId,
      y: null,
      timestamp,
    })

    // Step 2: Check if Y is null or expired
    const state1 = this.storage.get()
    if (state1?.y && !this.isExpired(state1.timestamp)) {
      // Y is held by another process, back off
      return false
    }

    // Step 3: Write our client ID to Y
    this.storage.set({
      x: state1?.x || null,
      y: this.clientId,
      timestamp,
    })

    // Step 4: Check if X is still ours
    const state2 = this.storage.get()
    if (state2?.x !== this.clientId) {
      // Another process got X, back off
      return false
    }

    // Step 5: Check if Y is still ours
    if (state2?.y !== this.clientId) {
      // Another process got Y, back off
      return false
    }

    // We successfully acquired the lock
    return true
  }

  /**
   * Checks if a timestamp is expired based on the timeout.
   */
  private isExpired(timestamp: number): boolean {
    return Date.now() - timestamp > this.timeout
  }

  /**
   * Cleans up any partial lock state.
   */
  private async cleanup(): Promise<void> {
    try {
      const state = this.storage.get()
      if (state) {
        // Only clean up if we own the locks
        const shouldClearX = state.x === this.clientId
        const shouldClearY = state.y === this.clientId

        if (shouldClearX || shouldClearY) {
          this.storage.set({
            x: shouldClearX ? null : state.x,
            y: shouldClearY ? null : state.y,
            timestamp: Date.now(),
          })
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Generates a unique client ID for this tab.
   */
  private generateClientId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }

  /**
   * Utility function to sleep for a given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

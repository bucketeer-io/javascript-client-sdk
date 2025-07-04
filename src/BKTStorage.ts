export const keyname = (prefix: string, key: string): string =>
  `${prefix}_${key}`

export interface BKTStorage<T> {
  set(value: T | null): Promise<void>
  get(): Promise<T | null>
  clear(): Promise<void>
}

export class BrowserLocalStorage<T> implements BKTStorage<T> {
  constructor(private key: string) {}

  public async set(value: T | null) {
    localStorage.setItem(this.key, JSON.stringify(value))
  }

  public async get(): Promise<T | null> {
    const result = localStorage.getItem(this.key)
    if (result === null) {
      return null
    }
    return JSON.parse(result) as T
  }

  public async clear() {
    localStorage.removeItem(this.key)
  }
}

export class InMemoryStorage<T> implements BKTStorage<T> {
  private cache: Record<string, T | null> = {}

  constructor(private key: string) {}

  async set(value: T | null) {
    this.cache[this.key] = value
  }

  async get(): Promise<T | null> {
    return this.cache[this.key] ?? null
  }

  async clear() {
    delete this.cache[this.key]
  }
}

/**
 * Automatically pick up the storage implementation to use based on the environment.
 * In the browser, use localStorage. In Node.js, use in-memory storage.
 *
 * @param key storage key
 * @returns BKTStorage<T>
 */
export const createBKTStorage = <T>(key: string): BKTStorage<T> => {
  if (typeof localStorage !== 'undefined') {
    return new BrowserLocalStorage<T>(key)
  } else {
    return new InMemoryStorage<T>(key)
  }
}

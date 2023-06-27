export const keyname = (prefix: string, key: string): string =>
  `${prefix}_${key}`

export interface BKTStorage<T> {
  set(value: T | null): void
  get(): T | null
  clear(): void
}

export class DefaultStorage<T> implements BKTStorage<T> {
  constructor(private key: string) {}

  public set<T>(value: T | null) {
    localStorage.setItem(this.key, JSON.stringify(value))
  }

  public get<T>(): T | null {
    const result = localStorage.getItem(this.key)
    if (result === null) {
      return null
    }
    return JSON.parse(result) as T
  }

  public clear() {
    localStorage.removeItem(this.key)
  }
}

export class InMemoryStorage<T> implements BKTStorage<T> {
  private cache: Record<string, T | null> = {}

  constructor(private key: string) {}

  set(value: T | null): void {
    this.cache[this.key] = value
  }

  get(): T | null {
    return this.cache[this.key]
  }
  clear(): void {
    delete this.cache[this.key]
  }
}

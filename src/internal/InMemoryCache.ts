export class InMemoryCache<T> {
  private cache: Record<string, T | null> = {}

  constructor(private key: string) {}

  set(value: T | null): void {
    this.cache[this.key] = value
  }

  get(): T | null {
    return this.cache[this.key] ?? null
  }

  clear(): void {
    delete this.cache[this.key]
  }
}

export interface EventSourceLike {
  new (url: string, init?: EventSourceLikeInit): EventSourceInstance
}

export interface EventSourceLikeInit {
  method?: string
  headers?: Record<string, string>
  body?: string | null
}

export interface EventSourceInstance {
  readonly readyState: number
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: MessageEventLike) => void) | null
  onerror: ((ev: { status?: number } | unknown) => void) | null
  addEventListener(type: string, listener: (ev: MessageEventLike) => void): void
  removeEventListener(type: string, listener: (ev: MessageEventLike) => void): void
  close(): void
}

export interface MessageEventLike {
  data?: string
}

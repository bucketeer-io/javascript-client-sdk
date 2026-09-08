import type { RawBKTConfig } from '@bucketeer/js-client-sdk'

export type Mode = 'polling' | 'streaming' | 'custom'

export type StreamEvent =
  | { kind: 'request'; path: string; method: string }
  | { kind: 'response'; path: string; status: number }
  | { kind: 'open' }
  | { kind: 'sse'; name: string; bytes: number } // put | patch | error
  | { kind: 'heartbeat' }
  | { kind: 'closed'; status?: number; terminal?: boolean }
  | { kind: 'note'; text: string }

export type StreamReporter = (event: StreamEvent) => void

// FetchLike is internal and not exported from the SDK, so the fetch type is
// read off the public config type instead.
export type BKTFetch = NonNullable<RawBKTConfig['fetch']>

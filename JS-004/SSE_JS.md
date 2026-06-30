# SSE Implementation Plan: JavaScript SDK

Real-time feature flag updates via Server-Sent Events (SSE) as an alternative to
the current polling mechanism. Extracted from the cross-platform SSE
Implementation Guide; this document covers only the JavaScript/TypeScript SDK.

---

## Overview

Add opt-in SSE support so the SDK receives feature flag updates in near real time
instead of polling every 10 minutes (min 60s). SSE is opt-in, falls back to
polling on failure, and requires no new mandatory dependencies.

- Browser: native `EventSource` (built-in, zero config)
- Node.js: user provides an `eventsource` package
- React Native: user provides `react-native-sse`

> Blocking dependency: the backend must implement a streaming
> `/stream_evaluations` endpoint first. The backend currently only supports
> unary request/response.

---

## Backend Requirement (prerequisite)

The SDK work depends on a backend SSE endpoint. Recommended approach is an HTTP
SSE endpoint on the Gateway service that:

- Sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`
- Parses user context from the request, resolves environment from the API key
- Sends an initial evaluation snapshot, then pushes only changed evaluations
- Emits a heartbeat comment (`: heartbeat\n\n`) every ~30s to keep the
  connection alive

Infrastructure needed: change detection (pubsub/db triggers), per-environment
connection tracking, broadcasting (Redis Pub/Sub for multi-instance), and
scalability via sticky sessions or distributed state.

---

## Configuration

Add SSE options to the raw config:

```typescript
// src/BKTConfig.ts
export interface RawBKTConfig {
  apiKey: string
  apiEndpoint: string
  appVersion: string

  // Existing
  fetch?: FetchLike
  pollingInterval?: number

  // NEW: SSE configuration
  eventSource?: EventSourceLike         // User provides for Node.js / RN
  enableStreaming?: boolean             // Enable SSE (default: false)
  streamingFallbackToPolling?: boolean  // Fallback on error (default: true)
}
```

### Config resolution

```typescript
// src/BKTConfig.ts
export const defineBKTConfig = (config: RawBKTConfig): BKTConfig => {
  const result: BKTConfig = {
    apiKey: config.apiKey,
    apiEndpoint: config.apiEndpoint,
    appVersion: config.appVersion,
    fetch: config.fetch ?? globalThis.fetch,

    // Auto-detect EventSource or use provided
    eventSource: config.eventSource ?? globalThis.EventSource,
    enableStreaming: config.enableStreaming ?? false,
    streamingFallbackToPolling: config.streamingFallbackToPolling ?? true,
  }

  // Validate streaming config
  if (result.enableStreaming && !result.eventSource) {
    throw new IllegalArgumentException(
      'enableStreaming is true but no EventSource implementation available. ' +
      'Provide config.eventSource (e.g., "eventsource" package for Node.js)'
    )
  }

  return result
}
```

---

## Code Implementation

### 1. EventSource type definitions

```typescript
// src/internal/streaming/eventSourceTypes.ts
export interface EventSourceLike {
  new(url: string, eventSourceInitDict?: EventSourceInit): EventSourceInstance
}

export interface EventSourceInstance {
  readonly readyState: number
  readonly url: string
  onopen: ((this: EventSourceInstance, ev: Event) => any) | null
  onmessage: ((this: EventSourceInstance, ev: MessageEvent) => any) | null
  onerror: ((this: EventSourceInstance, ev: Event) => any) | null
  close(): void

  readonly CONNECTING: 0
  readonly OPEN: 1
  readonly CLOSED: 2
}
```

### 2. SSE client

```typescript
// src/internal/streaming/SSEClient.ts
export class SSEClient {
  private eventSource: EventSourceInstance | null = null
  private reconnectAttempts = 0

  constructor(
    private readonly EventSource: EventSourceLike,
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  connect(
    userId: string,
    userEvaluationsId: string,
    onUpdate: (evaluation: Evaluation) => void,
    onError: (error: Error) => void,
  ): () => void {
    // Note: EventSource doesn't support custom headers
    // Must pass apiKey as query parameter
    const url = `${this.endpoint}/stream_evaluations?` +
      `apiKey=${encodeURIComponent(this.apiKey)}&` +
      `userId=${encodeURIComponent(userId)}&` +
      `userEvaluationsId=${encodeURIComponent(userEvaluationsId)}`

    this.eventSource = new this.EventSource(url)

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0
    }

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onUpdate(data)
      } catch (e) {
        onError(new Error(`Failed to parse SSE message: ${e}`))
      }
    }

    this.eventSource.onerror = (error) => {
      onError(new Error('SSE connection error'))
      this.scheduleReconnect()
    }

    // Return cleanup function
    return () => this.disconnect()
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++
    const backoff = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      60000  // Max 1 minute
    )
    setTimeout(() => this.connect(), backoff)
  }

  disconnect(): void {
    this.eventSource?.close()
    this.eventSource = null
  }
}
```

---

## Important Limitation: EventSource headers

The standard browser `EventSource` API does not support custom headers.

Solutions:
1. Query parameter auth (cross-platform compatible)
2. Cookies (same-domain only)
3. Node.js polyfill with header support (server-side only)

---

## Usage Examples

### Browser (zero config)

```typescript
import { initializeBKTClient } from '@bucketeer/js-client-sdk'

const client = initializeBKTClient({
  apiKey: 'your-api-key',
  apiEndpoint: 'https://api.bucketeer.io',
  appVersion: '1.0.0',
  enableStreaming: true,  // Uses native EventSource
})
```

### Node.js (user provides polyfill)

```typescript
import { initializeBKTClient } from '@bucketeer/js-client-sdk'
import EventSource from 'eventsource'  // npm install eventsource

const client = initializeBKTClient({
  apiKey: 'your-api-key',
  apiEndpoint: 'https://api.bucketeer.io',
  appVersion: '1.0.0',
  enableStreaming: true,
  eventSource: EventSource,  // User provides it
})
```

---

## Effort Estimate

| Item | Detail |
|------|--------|
| Files to create | 3 (SSEClient, eventSourceTypes, config) |
| Files to modify | 4 (Config, ApiClient, TaskScheduler, Interactor) |
| Est. lines of code | ~500 |
| Est. effort | 2-3 days implementation, 1-2 days testing |

---

## Backward Compatibility

- Polling remains enabled by default; SSE is opt-in via `enableStreaming`.
- Automatic fallback to polling if SSE fails.
- No changes to existing public interfaces.

```typescript
// Before
const client = initializeBKTClient({
  apiKey: 'key',
  apiEndpoint: 'https://api.example.com',
  pollingInterval: 600000,
})

// After (with SSE)
const client = initializeBKTClient({
  apiKey: 'key',
  apiEndpoint: 'https://api.example.com',
  pollingInterval: 600000,  // Still used as fallback
  enableStreaming: true,    // NEW: opt-in to SSE
})
```

### Graceful degradation scenarios

1. Backend doesn't support SSE -> fall back to polling
2. Network error -> exponential backoff reconnection
3. Connection timeout -> switch to polling temporarily
4. EventSource not available (Node.js without polyfill) -> use polling

---

## Testing Strategy

### Unit tests (SSE client)
- Parse SSE message format correctly
- Handle connection lifecycle (open, close, error)
- Reconnection with exponential backoff
- Graceful error handling

### Integration with interactor
- Update listeners triggered on new evaluations
- Cache updated correctly
- Fallback to polling on failure

### E2E
- Initialize SDK with streaming enabled
- Receive initial evaluations
- Update flag on backend -> SDK receives update via SSE < 1 second
- Listener callback triggered

---

## Best Practices

- SSE should be opt-in (not default initially)
- Automatic fallback to polling on any SSE failure
- Exponential backoff for reconnection (5s -> 60s max)
- Heartbeat/ping to detect stale connections (30-60s interval)
- Graceful shutdown / cleanup on destroy
```
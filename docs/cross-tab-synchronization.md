# Cross-Tab Synchronization

## Problem Statement

When users open multiple tabs of the same web application, each tab runs its own instance of the Bucketeer JavaScript SDK. This creates race conditions when accessing shared localStorage, leading to:

1. **Data Loss**: One tab's changes can overwrite another tab's changes
2. **Duplicate Events**: The same event might be sent multiple times by different tabs
3. **Inconsistent State**: Events might get lost or duplicated during concurrent access

## Root Cause

The issue occurs in the `EventStorageImpl.add()` method, which performs a non-atomic read-modify-write operation:

```typescript
add(event: Event): void {
  const entity = this.getInternal(this.userId)  // READ
  entity.events.push(event)                     // MODIFY
  this.storage.set(entity)                      // WRITE
}
```

When multiple tabs execute this sequence simultaneously:

- Tab A reads the current events
- Tab B reads the current events (same data)
- Tab A adds an event and saves
- Tab B adds an event and saves (overwrites Tab A's changes)

## Solution Overview

The solution implements a **Cross-Tab Mutex** using localStorage and Lamport's Fast Mutex algorithm to provide exclusive access to shared resources across browser tabs.

### Architecture Diagram

```mermaid
graph TB
    subgraph "Browser Window"
        subgraph "Tab 1"
            T1[BKT Client]
            T1E[EventStorage]
            T1M[CrossTabMutex]
            T1 --> T1E
            T1E --> T1M
        end

        subgraph "Tab 2"
            T2[BKT Client]
            T2E[EventStorage]
            T2M[CrossTabMutex]
            T2 --> T2E
            T2E --> T2M
        end

        subgraph "Tab 3"
            T3[BKT Client]
            T3E[EventStorage]
            T3M[CrossTabMutex]
            T3 --> T3E
            T3E --> T3M
        end
    end

    subgraph "Shared Storage"
        LS[localStorage]
        MX[Mutex Keys X & Y]
        EV[Event Data]

        LS --> MX
        LS --> EV
    end

    subgraph "Lamport's Fast Mutex Algorithm"
        STEP1["1. Write Client ID to X"]
        STEP2["2. Check if Y is available"]
        STEP3["3. Write Client ID to Y"]
        STEP4["4. Verify X & Y ownership"]

        STEP1 --> STEP2
        STEP2 --> STEP3
        STEP3 --> STEP4
    end

    T1M -.-> LS
    T2M -.-> LS
    T3M -.-> LS

    subgraph "Race Condition Prevention"
        RC1["❌ Without Mutex:<br/>Tab A reads events<br/>Tab B reads events<br/>Tab A writes events<br/>Tab B overwrites events"]

        RC2["✅ With Mutex:<br/>Tab A acquires lock<br/>Tab A reads/writes events<br/>Tab A releases lock<br/>Tab B acquires lock<br/>Tab B reads/writes events"]
    end

    style T1 fill:#e1f5fe
    style T2 fill:#e1f5fe
    style T3 fill:#e1f5fe
    style LS fill:#fff3e0
    style MX fill:#f3e5f5
    style EV fill:#e8f5e8
    style RC1 fill:#ffebee
    style RC2 fill:#e8f5e8
```

### Key Components

1. **CrossTabMutex**: Implements mutual exclusion using Lamport's Fast Mutex algorithm
2. **ThreadSafeEventStorage**: Wraps EventStorage with mutex protection
3. **Automatic Fallback**: Falls back to regular storage if mutex operations fail
4. **Backward Compatibility**: Maintains existing API surface

## Implementation Details

### CrossTabMutex

The mutex implementation uses two localStorage keys (X and Y) to coordinate access:

```typescript
class CrossTabMutex {
  async lock(): Promise<void> {
    // Implementation of Lamport's Fast Mutex algorithm
    // 1. Write client ID to X
    // 2. Check if Y is available
    // 3. Write client ID to Y
    // 4. Verify X and Y are still owned by this client
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.lock()
    try {
      return await fn()
    } finally {
      await this.unlock()
    }
  }
}
```

### ThreadSafeEventStorage

Provides both synchronous (backward compatible) and asynchronous (thread-safe) methods:

```typescript
class ThreadSafeEventStorage implements EventStorage {
  // Synchronous methods for backward compatibility
  add(event: Event): void {
    /* ... */
  }

  // Asynchronous methods for cross-tab safety
  async addAsync(event: Event): Promise<void> {
    return this.mutex.withLockSync(() => {
      this.eventStorage.add(event)
    })
  }
}
```

### Automatic Detection

The SDK automatically enables cross-tab safety in browser environments:

```typescript
private shouldEnableCrossTabSafety(): boolean {
  // Check if we're in a browser environment
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return false
  }
  return true
}
```

### Mutex Coordination Sequence

The following sequence diagram shows how the mutex coordinates access when multiple tabs try to add events simultaneously:

```mermaid
sequenceDiagram
    participant T1 as Tab 1
    participant T2 as Tab 2
    participant LS as localStorage
    participant Server as Bucketeer API

    Note over T1, T2: User triggers events in both tabs simultaneously

    T1->>T1: Generate event
    T2->>T2: Generate event

    par Tab 1 tries to add event
        T1->>LS: Step 1: Write ClientID_1 to X
        T1->>LS: Step 2: Check if Y is available
        T1->>LS: Step 3: Write ClientID_1 to Y
        T1->>LS: Step 4: Verify X & Y are owned by ClientID_1
        Note over T1, LS: ✅ Lock acquired successfully

        T1->>LS: Read current events
        T1->>T1: Add new event to list
        T1->>LS: Save updated events
        T1->>LS: Release lock (clear X)

    and Tab 2 tries to add event
        T2->>LS: Step 1: Write ClientID_2 to X
        T2->>LS: Step 2: Check if Y is available
        Note over T2, LS: Y is owned by ClientID_1 - back off

        T2->>T2: Wait 50ms
        T2->>LS: Step 1: Write ClientID_2 to X
        T2->>LS: Step 2: Check if Y is available
        T2->>LS: Step 3: Write ClientID_2 to Y
        T2->>LS: Step 4: Verify X & Y are owned by ClientID_2
        Note over T2, LS: ✅ Lock acquired successfully

        T2->>LS: Read current events (includes T1's event)
        T2->>T2: Add new event to list
        T2->>LS: Save updated events
        T2->>LS: Release lock (clear X)
    end

    Note over T1, T2: Both events are safely stored without data loss

    T1->>Server: Send events (periodic flush)
    Server-->>T1: Success
    T1->>LS: Delete sent events

    alt Events remaining
        T2->>Server: Send remaining events
        Server-->>T2: Success
        T2->>LS: Delete sent events
    end

    Note over T1, Server: All events delivered exactly once
```

## Configuration Options

The mutex can be configured with the following options:

```typescript
interface CrossTabMutexOptions {
  timeout?: number // Maximum time to hold a lock (default: 5000ms)
  lockCheckInterval?: number // How often to check for lock availability (default: 50ms)
  maxRetries?: number // Maximum number of retry attempts (default: 100)
}
```

## Error Handling

The implementation includes robust error handling:

1. **Timeout Protection**: Locks automatically expire to prevent deadlocks
2. **Graceful Degradation**: Falls back to regular storage if mutex fails
3. **Best-effort Cleanup**: Unlock operations never throw errors
4. **Retry Logic**: Automatic retries with exponential backoff

## Performance Considerations

- **Minimal Overhead**: Only adds overhead when multiple tabs are actually contending
- **Non-blocking**: Uses async/await to avoid blocking the main thread
- **Efficient Polling**: Configurable polling intervals to balance responsiveness and CPU usage
- **Automatic Cleanup**: Expired locks are automatically cleaned up

## Browser Compatibility

The solution works in all modern browsers that support:

- localStorage (IE8+)
- Promises (or polyfill)
- setTimeout/clearTimeout

## Usage Examples

### Basic Usage (Automatic)

The cross-tab safety is enabled automatically in browser environments:

```typescript
import { initializeBKTClient } from '@bucketeer/javascript-client-sdk'

// Cross-tab safety is automatically enabled
const client = await initializeBKTClient({
  apiKey: 'your-api-key',
  apiEndpoint: 'https://api.bucketeer.io',
  userId: 'user-123',
  appVersion: '1.0.0',
})
```

### Manual Configuration

For custom timeout settings:

```typescript
// This would be added to BKTConfig in the future
const client = await initializeBKTClient({
  // ... other config
  crossTabSafety: {
    timeout: 3000,
    lockCheckInterval: 25,
    maxRetries: 120,
  },
})
```

## Testing Cross-Tab Behavior

To test the cross-tab synchronization:

1. Open your application in multiple tabs
2. Trigger events simultaneously in different tabs
3. Verify that all events are properly stored and sent
4. Check browser DevTools for any race condition warnings

## Monitoring

The implementation includes console warnings for troubleshooting:

```typescript
// Warnings you might see:
console.warn(
  'Failed to add event with cross-tab safety, falling back to sync:',
  error,
)
console.warn(
  'Failed to create thread-safe event storage, falling back to regular storage:',
  error,
)
```

## Migration Guide

### For Existing Applications

The solution is **fully backward compatible**. No code changes are required - cross-tab safety is automatically enabled when multiple tabs are detected.

### For New Applications

New applications can rely on the automatic cross-tab safety without any special configuration.

## Future Enhancements

Potential future improvements include:

1. **Web Locks API**: Use native Web Locks API when available (Chrome 69+)
2. **SharedArrayBuffer**: Use SharedArrayBuffer for even better performance
3. **Configuration Options**: Add BKTConfig options for fine-tuning
4. **Metrics**: Add telemetry for cross-tab coordination events

## References

- [Lamport's Fast Mutex Algorithm (1985)](http://research.microsoft.com/en-us/um/people/lamport/pubs/fast-mutex.pdf)
- [MDN Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [localStorage Cross-Tab Communication](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)

## Troubleshooting

### Common Issues

1. **High CPU Usage**: Reduce `lockCheckInterval` or increase `timeout`
2. **Deadlocks**: Locks automatically expire - check `timeout` setting
3. **Events Missing**: Check console for fallback warnings
4. **Performance Issues**: Monitor lock contention frequency

### Debug Information

Enable debug logging by setting:

```typescript
localStorage.setItem('bucketeer_debug', 'true')
```

This will show detailed information about lock acquisition and release.

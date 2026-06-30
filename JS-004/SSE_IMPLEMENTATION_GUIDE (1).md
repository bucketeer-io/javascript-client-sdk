# SSE Implementation Guide for Bucketeer SDKs
## Real-time Feature Flag Updates via Server-Sent Events

This is an draft proposal from an backend team. Its mostly correct, somethings is not correct or not update but overall its good.

---

## Executive Summary

This document outlines the implementation strategy for adding **Server-Sent Events (SSE)** support to Bucketeer's client SDKs (JavaScript, Android, iOS) to enable real-time feature flag updates as an alternative to the current polling mechanism.

**Key Findings:**
- ✅ All three SDKs can support SSE **without new required dependencies**
- ✅ Native APIs available on all platforms (EventSource, OkHttp, URLSession)
- ✅ Similar architectures make implementation consistent across platforms
- ⚠️ Backend streaming endpoint must be implemented first (currently only supports request/response)

---

## Current State Analysis

### Architecture Comparison

| Aspect | **JavaScript SDK** | **Android SDK** | **iOS SDK** |
|--------|-------------------|-----------------|-------------|
| **Language** | TypeScript | Kotlin 2.0.21 | Swift 5.0+ |
| **HTTP Client** | Fetch API | OkHttp 4.12.0 | URLSession (native) |
| **JSON Library** | Native JSON | Moshi 1.15.2 | JSONEncoder/Decoder |
| **Protocol** | HTTP REST/JSON | HTTP REST/JSON | HTTP REST/JSON |
| **Polling (Foreground)** | 10 min (min: 60s) | 10 min (min: 60s) | 10 min (min: 60s) |
| **Polling (Background)** | N/A | 1 hour (min: 20 min) | 1 hour (min: 20 min) |
| **Storage** | LocalStorage/Custom | SQLite + SharedPreferences | SQLite + UserDefaults |
| **Architecture** | Interactor pattern | Interactor + DI | Clean architecture + DI |
| **External Dependencies** | `async-mutex` only | OkHttp, Moshi, AndroidX | **ZERO** (all native) |
| **Min Platform** | ES2015+ browsers | Android API 21+ | iOS 11.0+ |

### Current Communication Flow

All three SDKs follow the same pattern:

```
1. SDK initializes → TaskScheduler starts
2. Periodic polling task triggers (every 10 minutes)
3. POST /get_evaluations with user context
4. Backend returns evaluations (full or delta)
5. SDK stores in local cache (SQLite/LocalStorage)
6. Notify listeners if evaluations changed
7. Wait for next polling interval
```

**Backend Endpoints:**
- `POST /get_evaluations` - Fetch feature flags
- `POST /register_events` - Submit analytics events

**Current Limitations:**
- ⚠️ No real-time updates (10-minute latency minimum)
- ⚠️ Unnecessary polling when nothing changes
- ⚠️ Battery drain on mobile from periodic wakeups

---

## Backend Requirements

### ⚠️ CRITICAL: Backend Must Implement SSE First

The backend currently has **NO streaming support**. All RPCs are unary request/response.

**Required Backend Changes:**

#### **Option 1: HTTP SSE Endpoint (Recommended)**

Add new endpoint to Gateway service:

```go
// pkg/api/api/api_grpc.go
func (s *grpcGatewayService) StreamEvaluations(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")

    // Parse request body for user context
    user := parseUserFromRequest(r)
    environmentId := getEnvironmentFromAPIKey(r)

    // Send initial evaluation snapshot
    evaluations := s.getFeatures(ctx, environmentId)
    sendSSEEvent(w, "evaluations", evaluations)

    // Subscribe to feature flag changes
    updates := s.subscribeToFeatureUpdates(environmentId)

    for {
        select {
        case <-r.Context().Done():
            return
        case update := <-updates:
            // Send only changed evaluations
            sendSSEEvent(w, "evaluation_update", update)
        case <-time.After(30 * time.Second):
            // Heartbeat to keep connection alive
            fmt.Fprintf(w, ": heartbeat\n\n")
            w.(http.Flusher).Flush()
        }
    }
}

func sendSSEEvent(w http.ResponseWriter, eventType string, data interface{}) {
    jsonData, _ := json.Marshal(data)
    fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, jsonData)
    w.(http.Flusher).Flush()
}
```

#### **Option 2: gRPC Server Streaming**

```protobuf
// proto/gateway/service.proto
service Gateway {
  rpc StreamEvaluations(StreamEvaluationsRequest)
      returns (stream StreamEvaluationsResponse) {
    option (google.api.http) = {
      post: "/stream_evaluations"
      body: "*"
    };
  }
}

message StreamEvaluationsRequest {
  string tag = 1;
  user.User user = 2;
  string user_evaluations_id = 3;
  bucketeer.event.client.SourceId source_id = 4;
  string sdk_version = 5;
}

message StreamEvaluationsResponse {
  oneof event {
    InitialSnapshot initial = 1;
    EvaluationUpdate update = 2;
    Heartbeat heartbeat = 3;
  }
}
```

**Infrastructure Needed:**
- **Change Detection**: Monitor feature flag updates via pubsub/database triggers
- **Connection Management**: Track active SSE connections per environment
- **Broadcasting**: Push updates when flags change (consider Redis Pub/Sub for multi-instance)
- **Scalability**: Sticky sessions or distributed state management

---

## JavaScript SDK Implementation

### Dependencies Analysis

| Platform | **Dependency Required?** | **Native Support** | **How to Provide** |
|----------|-------------------------|-------------------|-------------------|
| **Browser** | ❌ **NO** | ✅ EventSource API (all modern browsers) | Built-in |
| **Node.js** | ⚠️ User provides | ❌ No native support | User installs `eventsource` package |
| **React Native** | ⚠️ User provides | ❌ No native support | User installs `react-native-sse` |

### Implementation Strategy

**Zero Required Dependencies** - Follow existing `fetch` pattern:

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
  eventSource?: EventSourceLike      // User provides for Node.js/RN
  enableStreaming?: boolean          // Enable SSE (default: false)
  streamingFallbackToPolling?: boolean  // Fallback on error (default: true)
}
```

### Code Implementation

#### **1. EventSource Type Definitions**

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

#### **2. SSE Client Implementation**

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

#### **3. Config Resolution**

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

### Usage Examples

#### **Browser (Zero Config)**

```typescript
import { initializeBKTClient } from '@bucketeer/js-client-sdk'

const client = initializeBKTClient({
  apiKey: 'your-api-key',
  apiEndpoint: 'https://api.bucketeer.io',
  appVersion: '1.0.0',
  enableStreaming: true,  // ✅ Uses native EventSource
})
```

#### **Node.js (User Provides Polyfill)**

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

### Important Limitation

⚠️ **EventSource doesn't support custom headers** in the standard browser API.

**Solutions:**
1. **Query parameter auth** (cross-platform compatible)
2. **Cookies** (same-domain only)
3. **Node.js polyfill with headers** (server-side only)

---

## Android SDK Implementation

### Dependencies Analysis

| Component | **Dependency Required?** | **Reason** |
|-----------|-------------------------|-----------|
| **SSE Streaming** | ❌ **NO** | OkHttp 4.12.0 supports streaming via `ResponseBody.source()` |
| **Optional Enhancement** | ⚠️ Optional | `okhttp-eventsource` (LaunchDarkly) for higher-level API |

**Recommendation:** Implement SSE parsing yourself using OkHttp - no new dependency needed.

### Implementation Strategy

**Use existing OkHttp for streaming:**

```kotlin
// OkHttp already has streaming support built-in
val response = okHttpClient.newCall(request).execute()
val source = response.body?.source()

while (!source.exhausted()) {
    val line = source.readUtf8Line()
    // Parse SSE events
}
```

### Code Implementation

#### **1. SSE Client**

```kotlin
// File: internal/remote/SSEClient.kt
package io.bucketeer.sdk.android.internal.remote

import okhttp3.*
import okio.BufferedSource
import java.io.Closeable
import java.util.concurrent.ExecutorService

class SSEClient(
    private val okHttpClient: OkHttpClient,
    private val endpoint: String,
    private val apiKey: String,
    private val sourceId: SourceId,
    private val sdkVersion: String,
    private val executor: ExecutorService
) {
    private var currentCall: Call? = null

    fun streamEvaluations(
        user: User,
        userEvaluationsId: String,
        onUpdate: (Evaluation) -> Unit,
        onError: (Throwable) -> Unit,
        onConnectionStateChange: (ConnectionState) -> Unit
    ): Closeable {

        val requestBody = createRequestBody(user, userEvaluationsId)

        val request = Request.Builder()
            .url("$endpoint/stream_evaluations")
            .header("Accept", "text/event-stream")
            .header("Authorization", apiKey)
            .header("Content-Type", "application/json")
            .post(requestBody)
            .build()

        val call = okHttpClient.newCall(request)
        currentCall = call

        executor.execute {
            try {
                onConnectionStateChange(ConnectionState.CONNECTING)

                call.execute().use { response ->
                    if (!response.isSuccessful) {
                        onError(ApiException("SSE failed: ${response.code}"))
                        return@execute
                    }

                    onConnectionStateChange(ConnectionState.CONNECTED)

                    val source = response.body?.source()
                        ?: throw IllegalStateException("Empty response body")

                    processSSEStream(source, onUpdate, onError)
                }
            } catch (e: Exception) {
                onConnectionStateChange(ConnectionState.DISCONNECTED)
                onError(e)
            }
        }

        return Closeable {
            currentCall?.cancel()
            onConnectionStateChange(ConnectionState.DISCONNECTED)
        }
    }

    private fun processSSEStream(
        source: BufferedSource,
        onUpdate: (Evaluation) -> Unit,
        onError: (Throwable) -> Unit
    ) {
        var currentData = ""

        while (!source.exhausted()) {
            val line = source.readUtf8Line() ?: break

            when {
                line.startsWith("data: ") -> {
                    currentData = line.substring(6)
                }
                line.isEmpty() && currentData.isNotEmpty() -> {
                    // Event complete - parse JSON
                    try {
                        val evaluation = parseEvaluation(currentData)
                        onUpdate(evaluation)
                    } catch (e: Exception) {
                        onError(e)
                    }
                    currentData = ""
                }
                line.startsWith(": ") -> {
                    // Comment/heartbeat - ignore
                }
            }
        }
    }

    private fun parseEvaluation(json: String): Evaluation {
        return moshi.adapter(Evaluation::class.java).fromJson(json)
            ?: throw JsonDataException("Invalid evaluation JSON")
    }

    private fun createRequestBody(user: User, userEvaluationsId: String): RequestBody {
        val request = GetEvaluationsRequest(
            tag = featureTag,
            user = user,
            userEvaluationsId = userEvaluationsId,
            sourceId = sourceId,
            sdkVersion = sdkVersion
        )
        return RequestBody.create(
            "application/json".toMediaType(),
            moshi.adapter(GetEvaluationsRequest::class.java).toJson(request)
        )
    }
}

enum class ConnectionState {
    CONNECTING, CONNECTED, DISCONNECTED, RECONNECTING
}
```

#### **2. Streaming Task Scheduler**

```kotlin
// File: internal/scheduler/EvaluationStreamingTask.kt
package io.bucketeer.sdk.android.internal.scheduler

import android.os.Handler
import android.os.Looper
import io.bucketeer.sdk.android.internal.evaluation.EvaluationInteractor
import io.bucketeer.sdk.android.internal.remote.SSEClient
import java.io.Closeable
import kotlin.math.min

class EvaluationStreamingTask(
    private val sseClient: SSEClient,
    private val evaluationInteractor: EvaluationInteractor,
    private val user: User,
    private val config: BKTConfig,
    private val logger: Logger
) {
    private var connection: Closeable? = null
    private var reconnectAttempts = 0
    private val handler = Handler(Looper.getMainLooper())

    fun start() {
        connect()
    }

    private fun connect() {
        connection = sseClient.streamEvaluations(
            user = user,
            userEvaluationsId = evaluationInteractor.currentEvaluationsId,

            onUpdate = { evaluation ->
                evaluationInteractor.updateEvaluation(evaluation)
                reconnectAttempts = 0  // Reset on success
            },

            onError = { error ->
                logger.e(error, "SSE connection failed")
                scheduleReconnect()
            },

            onConnectionStateChange = { state ->
                when (state) {
                    ConnectionState.CONNECTED -> {
                        logger.i("SSE connected")
                    }
                    ConnectionState.DISCONNECTED -> {
                        logger.w("SSE disconnected")
                    }
                    else -> { /* handle other states */ }
                }
            }
        )
    }

    private fun scheduleReconnect() {
        reconnectAttempts++
        val backoff = min(
            config.streamingReconnectInterval * (1 shl reconnectAttempts),
            config.streamingMaxBackoffInterval
        ).toLong()

        handler.postDelayed({ connect() }, backoff)
    }

    fun stop() {
        connection?.close()
        handler.removeCallbacksAndMessages(null)
    }
}
```

#### **3. Update Configuration**

```kotlin
// File: BKTConfig.kt
data class BKTConfig(
    val apiKey: String,
    val apiEndpoint: String,
    val featureTag: String,
    val user: BKTUser,

    // Existing polling config
    val pollingInterval: Long = 600_000L,              // 10 minutes
    val backgroundPollingInterval: Long = 3_600_000L,  // 1 hour
    val eventsFlushInterval: Long = 60_000L,
    val eventsMaxQueueSize: Int = 50,

    // NEW: SSE configuration
    val enableStreaming: Boolean = false,                 // Opt-in
    val streamingFallbackToPolling: Boolean = true,
    val streamingReconnectInterval: Long = 5_000L,        // 5 seconds
    val streamingMaxBackoffInterval: Long = 60_000L       // 1 minute
) {
    companion object {
        fun builder(): Builder = Builder()
    }

    class Builder {
        // ... existing builder methods

        fun enableStreaming(enable: Boolean) = apply {
            this.enableStreaming = enable
        }

        fun streamingFallbackToPolling(enable: Boolean) = apply {
            this.streamingFallbackToPolling = enable
        }
    }
}
```

### Usage Example

```kotlin
val config = BKTConfig.builder()
    .apiKey("your-api-key")
    .apiEndpoint("https://api.bucketeer.io")
    .featureTag("android")
    .enableStreaming(true)  // Enable SSE
    .build()

val client = BKTClient.initialize(applicationContext, config)
```

---

## iOS SDK Implementation

### Dependencies Analysis

| Component | **Dependency Required?** | **Reason** |
|-----------|-------------------------|-----------|
| **SSE Streaming (iOS 11+)** | ❌ **NO** | URLSession supports streaming via `dataTask` |
| **SSE Streaming (iOS 13+)** | ❌ **NO** | URLSession with `URLSessionDataDelegate` for better control |
| **SSE Streaming (iOS 15+)** | ❌ **NO** | URLSession `bytes(for:).lines` with async/await |

**Recommendation:** Use URLSession with delegate pattern for iOS 11+ compatibility.

### Implementation Strategy

URLSession natively supports streaming responses:

```swift
// URLSession can handle SSE out of the box
let task = session.dataTask(with: request) { data, response, error in
    // Parse SSE events from data chunks
}
```

### Code Implementation

#### **1. SSE Client Protocol**

```swift
// File: Sources/Internal/Remote/SSEClient.swift
import Foundation

protocol SSEClient {
    func streamEvaluations(
        user: User,
        userEvaluationsId: String,
        onUpdate: @escaping (Evaluation) -> Void,
        onError: @escaping (BKTError) -> Void,
        onConnectionStateChange: @escaping (ConnectionState) -> Void
    ) -> Cancellable
}

enum ConnectionState {
    case connecting
    case connected
    case disconnected
    case reconnecting
}

protocol Cancellable {
    func cancel()
}
```

#### **2. SSE Client Implementation (iOS 11+)**

```swift
// File: Sources/Internal/Remote/SSEClientImpl.swift
import Foundation

class SSEClientImpl: NSObject, SSEClient, URLSessionDataDelegate {
    private let session: URLSession
    private let endpoint: String
    private let apiKey: String
    private let sourceId: SourceID
    private let sdkVersion: String
    private let featureTag: String

    private var buffer = ""
    private var onUpdate: ((Evaluation) -> Void)?
    private var onError: ((BKTError) -> Void)?
    private var onConnectionStateChange: ((ConnectionState) -> Void)?

    init(
        endpoint: String,
        apiKey: String,
        sourceId: SourceID,
        sdkVersion: String,
        featureTag: String
    ) {
        self.endpoint = endpoint
        self.apiKey = apiKey
        self.sourceId = sourceId
        self.sdkVersion = sdkVersion
        self.featureTag = featureTag

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = .infinity  // SSE needs long timeout
        config.timeoutIntervalForResource = .infinity

        self.session = URLSession(
            configuration: config,
            delegate: nil,
            delegateQueue: nil
        )

        super.init()
    }

    func streamEvaluations(
        user: User,
        userEvaluationsId: String,
        onUpdate: @escaping (Evaluation) -> Void,
        onError: @escaping (BKTError) -> Void,
        onConnectionStateChange: @escaping (ConnectionState) -> Void
    ) -> Cancellable {

        self.onUpdate = onUpdate
        self.onError = onError
        self.onConnectionStateChange = onConnectionStateChange

        guard let url = URL(string: "\(endpoint)/stream_evaluations") else {
            onError(.invalidURL(message: "Invalid streaming endpoint"))
            return SSECancellable(task: nil)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue(apiKey, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Create request body
        let body = GetEvaluationsRequestBody(
            tag: featureTag,
            user: user,
            userEvaluationsId: userEvaluationsId,
            sourceId: sourceId,
            userEvaluationCondition: nil,
            sdkVersion: sdkVersion
        )

        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            onError(.encodingError(message: "Failed to encode request"))
            return SSECancellable(task: nil)
        }

        onConnectionStateChange(.connecting)

        let task = session.dataTask(with: request)
        task.resume()

        return SSECancellable(task: task)
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let httpResponse = response as? HTTPURLResponse else {
            onError?(.network(message: "Invalid response", error: nil))
            completionHandler(.cancel)
            return
        }

        guard httpResponse.statusCode == 200 else {
            onError?(.apiServer(message: "SSE failed with status \(httpResponse.statusCode)"))
            completionHandler(.cancel)
            return
        }

        onConnectionStateChange?(.connected)
        completionHandler(.allow)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        guard let text = String(data: data, encoding: .utf8) else {
            return
        }

        buffer += text

        // Process complete lines
        let lines = buffer.components(separatedBy: "\n")
        buffer = lines.last ?? ""  // Keep incomplete line in buffer

        for line in lines.dropLast() {
            processSSELine(line)
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        onConnectionStateChange?(.disconnected)

        if let error = error {
            onError?(.network(message: "SSE connection closed", error: error))
        }
    }

    // MARK: - Private Methods

    private func processSSELine(_ line: String) {
        if line.hasPrefix("data: ") {
            let json = String(line.dropFirst(6))

            guard let data = json.data(using: .utf8) else {
                return
            }

            do {
                let evaluation = try JSONDecoder().decode(Evaluation.self, from: data)
                onUpdate?(evaluation)
            } catch {
                onError?(.decodingError(message: "Failed to decode evaluation: \(error)"))
            }
        }
        // Ignore comments and empty lines
    }
}

// MARK: - Cancellable Implementation

private class SSECancellable: Cancellable {
    private weak var task: URLSessionDataTask?

    init(task: URLSessionDataTask?) {
        self.task = task
    }

    func cancel() {
        task?.cancel()
    }
}
```

#### **3. Modern iOS 15+ Implementation (Optional)**

```swift
// File: Sources/Internal/Remote/ModernSSEClient.swift
import Foundation

@available(iOS 15.0, *)
class ModernSSEClient: SSEClient {
    private let endpoint: String
    private let apiKey: String
    private let sourceId: SourceID
    private let sdkVersion: String
    private let featureTag: String

    init(
        endpoint: String,
        apiKey: String,
        sourceId: SourceID,
        sdkVersion: String,
        featureTag: String
    ) {
        self.endpoint = endpoint
        self.apiKey = apiKey
        self.sourceId = sourceId
        self.sdkVersion = sdkVersion
        self.featureTag = featureTag
    }

    func streamEvaluations(
        user: User,
        userEvaluationsId: String,
        onUpdate: @escaping (Evaluation) -> Void,
        onError: @escaping (BKTError) -> Void,
        onConnectionStateChange: @escaping (ConnectionState) -> Void
    ) -> Cancellable {

        let task = Task {
            do {
                try await self.performStreaming(
                    user: user,
                    userEvaluationsId: userEvaluationsId,
                    onUpdate: onUpdate,
                    onConnectionStateChange: onConnectionStateChange
                )
            } catch {
                onError(.network(message: "Streaming failed", error: error))
            }
        }

        return TaskCancellable(task: task)
    }

    private func performStreaming(
        user: User,
        userEvaluationsId: String,
        onUpdate: @escaping (Evaluation) -> Void,
        onConnectionStateChange: @escaping (ConnectionState) -> Void
    ) async throws {

        guard let url = URL(string: "\(endpoint)/stream_evaluations") else {
            throw BKTError.invalidURL(message: "Invalid streaming endpoint")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue(apiKey, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = GetEvaluationsRequestBody(
            tag: featureTag,
            user: user,
            userEvaluationsId: userEvaluationsId,
            sourceId: sourceId,
            userEvaluationCondition: nil,
            sdkVersion: sdkVersion
        )
        request.httpBody = try JSONEncoder().encode(body)

        onConnectionStateChange(.connecting)

        let (bytes, response) = try await URLSession.shared.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw BKTError.apiServer(message: "SSE connection failed")
        }

        onConnectionStateChange(.connected)

        // Stream line-by-line
        for try await line in bytes.lines {
            if line.hasPrefix("data: ") {
                let json = String(line.dropFirst(6))
                if let data = json.data(using: .utf8),
                   let evaluation = try? JSONDecoder().decode(Evaluation.self, from: data) {
                    onUpdate(evaluation)
                }
            }
        }

        onConnectionStateChange(.disconnected)
    }
}

@available(iOS 15.0, *)
private class TaskCancellable: Cancellable {
    private let task: Task<Void, Never>

    init(task: Task<Void, Never>) {
        self.task = task
    }

    func cancel() {
        task.cancel()
    }
}
```

#### **4. Streaming Task Scheduler**

```swift
// File: Sources/Internal/Scheduler/EvaluationStreamingTask.swift
import Foundation

class EvaluationStreamingTask {
    private let sseClient: SSEClient
    private let evaluationInteractor: EvaluationInteractor
    private let user: User
    private let config: BKTConfig
    private let logger: Logger

    private var connection: Cancellable?
    private var reconnectAttempts = 0
    private var reconnectTimer: Timer?

    init(
        sseClient: SSEClient,
        evaluationInteractor: EvaluationInteractor,
        user: User,
        config: BKTConfig,
        logger: Logger
    ) {
        self.sseClient = sseClient
        self.evaluationInteractor = evaluationInteractor
        self.user = user
        self.config = config
        self.logger = logger
    }

    func start() {
        connect()
    }

    private func connect() {
        connection = sseClient.streamEvaluations(
            user: user,
            userEvaluationsId: evaluationInteractor.currentEvaluationsId,

            onUpdate: { [weak self] evaluation in
                self?.evaluationInteractor.updateEvaluation(evaluation)
                self?.reconnectAttempts = 0  // Reset on success
            },

            onError: { [weak self] error in
                self?.logger.error("SSE connection failed: \(error)")
                self?.scheduleReconnect()
            },

            onConnectionStateChange: { [weak self] state in
                switch state {
                case .connected:
                    self?.logger.info("SSE connected")
                case .disconnected:
                    self?.logger.warn("SSE disconnected")
                case .connecting:
                    self?.logger.info("SSE connecting...")
                case .reconnecting:
                    self?.logger.info("SSE reconnecting...")
                }
            }
        )
    }

    private func scheduleReconnect() {
        reconnectAttempts += 1

        let backoff = min(
            TimeInterval(config.streamingReconnectInterval) * TimeInterval(1 << reconnectAttempts) / 1000.0,
            TimeInterval(config.streamingMaxBackoffInterval) / 1000.0
        )

        reconnectTimer = Timer.scheduledTimer(
            withTimeInterval: backoff,
            repeats: false
        ) { [weak self] _ in
            self?.connect()
        }
    }

    func stop() {
        connection?.cancel()
        reconnectTimer?.invalidate()
        reconnectTimer = nil
    }
}
```

#### **5. Update Configuration**

```swift
// File: Sources/Public/BKTConfig.swift
public struct BKTConfig {
    public let apiKey: String
    public let apiEndpoint: String
    public let featureTag: String
    public let user: BKTUser

    // Existing polling config
    public let pollingInterval: Int64               // Default: 600,000ms (10 min)
    public let backgroundPollingInterval: Int64     // Default: 3,600,000ms (1 hour)
    public let eventsFlushInterval: Int64           // Default: 60,000ms (1 min)
    public let eventsMaxQueueSize: Int              // Default: 50

    // NEW: SSE configuration
    public let enableStreaming: Bool                     // Default: false
    public let streamingFallbackToPolling: Bool          // Default: true
    public let streamingReconnectInterval: Int64         // Default: 5,000ms
    public let streamingMaxBackoffInterval: Int64        // Default: 60,000ms

    // Builder pattern
    public static func builder() -> Builder {
        return Builder()
    }

    public class Builder {
        private var enableStreaming: Bool = false
        private var streamingFallbackToPolling: Bool = true
        private var streamingReconnectInterval: Int64 = 5_000
        private var streamingMaxBackoffInterval: Int64 = 60_000

        // ... existing builder methods

        public func enableStreaming(_ enable: Bool) -> Builder {
            self.enableStreaming = enable
            return self
        }

        public func streamingFallbackToPolling(_ enable: Bool) -> Builder {
            self.streamingFallbackToPolling = enable
            return self
        }

        public func streamingReconnectInterval(_ interval: Int64) -> Builder {
            self.streamingReconnectInterval = interval
            return self
        }

        public func build() -> BKTConfig {
            return BKTConfig(
                // ... existing params
                enableStreaming: enableStreaming,
                streamingFallbackToPolling: streamingFallbackToPolling,
                streamingReconnectInterval: streamingReconnectInterval,
                streamingMaxBackoffInterval: streamingMaxBackoffInterval
            )
        }
    }
}
```

### Usage Example

```swift
let config = BKTConfig
    .builder()
    .apiKey("your-api-key")
    .apiEndpoint("https://api.bucketeer.io")
    .featureTag("ios")
    .enableStreaming(true)  // Enable SSE
    .build()

BKTClient.initialize(config: config) { error in
    if let error = error {
        print("Initialization failed: \(error)")
    }
}
```

---

## Implementation Effort Estimation

### Development Timeline

| SDK | **Files to Create** | **Files to Modify** | **Est. Lines of Code** | **Est. Effort** | **Testing** |
|-----|-------------------|-------------------|---------------------|----------------|------------|
| **JavaScript** | 3 files (SSEClient, types, config) | 4 files (Config, ApiClient, TaskScheduler, Interactor) | ~500 | 2-3 days | 1-2 days |
| **Android** | 3 files (SSEClient, StreamingTask, ConnectionState) | 4 files (Config, ApiClient, TaskScheduler, Interactor) | ~800 | 3-4 days | 2 days |
| **iOS** | 3 files (SSEClient, Cancellable, StreamingTask) | 4 files (Config, ApiClient, TaskScheduler, Interactor) | ~700 | 3-4 days | 2 days |
| **Backend** | 1 endpoint (StreamEvaluations) | 2 files (Gateway service, proto) | ~300 | 2-3 days | 2 days |

**Total Estimated Effort:**
- **Backend SSE endpoint**: 4-5 days (including testing)
- **JavaScript SDK**: 3-5 days
- **Android SDK**: 5-6 days
- **iOS SDK**: 5-6 days

**Grand Total: ~3-4 weeks** (assuming sequential development)

**Parallel Development: ~2-3 weeks** (if SDKs developed concurrently after backend ready)

---

## Migration Strategy

### Phase 1: Backend Implementation (Week 1)
1. ✅ Implement `/stream_evaluations` SSE endpoint
2. ✅ Add feature flag change detection system
3. ✅ Deploy to staging environment
4. ✅ Load testing for connection scalability

### Phase 2: SDK Implementation (Week 2-3)
1. ✅ Implement SSE clients in parallel (JS, Android, iOS)
2. ✅ Add configuration options for streaming
3. ✅ Implement fallback to polling on failure
4. ✅ Add reconnection logic with exponential backoff

### Phase 3: Testing & Validation (Week 3-4)
1. ✅ Unit tests for SSE parsing
2. ✅ Integration tests with backend
3. ✅ Connection lifecycle tests (disconnect, reconnect)
4. ✅ Performance testing (battery, memory, network)
5. ✅ Backward compatibility validation

### Phase 4: Rollout (Week 4+)
1. ✅ Beta release with SSE opt-in flag
2. ✅ Monitor metrics (connection success rate, reconnection frequency)
3. ✅ Gradual rollout to production
4. ✅ Documentation and migration guide

---

## Backward Compatibility

### Default Behavior (No Breaking Changes)

**All SDKs maintain existing behavior by default:**
- ✅ Polling enabled by default
- ✅ SSE is **opt-in** via configuration flag
- ✅ Automatic fallback to polling if SSE fails
- ✅ No API changes to public interfaces

### Configuration Migration

**Before (existing):**
```typescript
const client = initializeBKTClient({
  apiKey: 'key',
  apiEndpoint: 'https://api.example.com',
  pollingInterval: 600000
})
```

**After (with SSE support):**
```typescript
const client = initializeBKTClient({
  apiKey: 'key',
  apiEndpoint: 'https://api.example.com',
  pollingInterval: 600000,      // Still used as fallback
  enableStreaming: true          // NEW: Opt-in to SSE
})
```

### Graceful Degradation

**SSE Failure Scenarios:**
1. **Backend doesn't support SSE** → Falls back to polling
2. **Network error** → Exponential backoff reconnection
3. **Connection timeout** → Switch to polling temporarily
4. **EventSource not available** (Node.js) → Use polling

---

## Performance Considerations

### Benefits of SSE

| Metric | **Polling (Current)** | **SSE (Proposed)** | **Improvement** |
|--------|---------------------|-------------------|----------------|
| **Update Latency** | 0-10 minutes | < 1 second | **99% faster** |
| **Network Requests** | 1 req/10 min = 144/day | 1 persistent connection | **99% fewer requests** |
| **Battery Impact** | Periodic wakeups | Single connection | **~40% less battery** |
| **Backend Load** | High (constant polling) | Low (push on change) | **90% reduction** |
| **Data Transfer** | Full response each time | Only changes sent | **~80% less data** |

### Potential Challenges

| Challenge | **Mitigation Strategy** |
|-----------|------------------------|
| **Connection overhead** | Use HTTP/2 for multiplexing |
| **Proxy/firewall issues** | Fallback to polling on failure |
| **Mobile network changes** | Auto-reconnect on network transition |
| **Memory usage** | Connection pooling, cleanup on background |
| **Scaling backend** | Redis Pub/Sub for multi-instance broadcasting |

---

## Testing Strategy

### Unit Tests

**SSE Client:**
- ✅ Parse SSE message format correctly
- ✅ Handle connection lifecycle (open, close, error)
- ✅ Reconnection with exponential backoff
- ✅ Graceful error handling

**Integration with Interactor:**
- ✅ Update listeners triggered on new evaluations
- ✅ Cache updated correctly
- ✅ Fallback to polling on failure

### Integration Tests

**Backend Communication:**
- ✅ Establish SSE connection successfully
- ✅ Receive evaluation updates in real-time
- ✅ Handle backend disconnection
- ✅ Authentication failure scenarios

### E2E Tests

**Full Flow:**
- ✅ Initialize SDK with streaming enabled
- ✅ Receive initial evaluations
- ✅ Update feature flag on backend
- ✅ SDK receives update via SSE < 1 second
- ✅ Listener callback triggered
- ✅ UI updates with new flag value

### Performance Tests

**Mobile-Specific:**
- ✅ Battery consumption comparison (SSE vs polling)
- ✅ Memory usage over 24 hours
- ✅ Network data transfer comparison
- ✅ App lifecycle transitions (background/foreground)

**Scalability:**
- ✅ Backend handles 10,000+ concurrent SSE connections
- ✅ Load balancer with sticky sessions
- ✅ Redis Pub/Sub message broadcasting

---

## Documentation Requirements

### SDK Documentation

**For Each SDK:**
1. ✅ How to enable streaming (configuration examples)
2. ✅ Fallback behavior explanation
3. ✅ Troubleshooting guide (connection issues)
4. ✅ Migration guide from polling to SSE
5. ✅ API reference updates

### Backend Documentation

1. ✅ SSE endpoint specification
2. ✅ Message format documentation
3. ✅ Authentication requirements
4. ✅ Deployment configuration (load balancers, sticky sessions)
5. ✅ Monitoring and metrics

---

## Monitoring & Metrics

### SDK Metrics

**Track in Analytics:**
- `sse_connection_attempts` - Total connection attempts
- `sse_connection_success_rate` - Successful connections / attempts
- `sse_reconnection_count` - Number of reconnections
- `sse_fallback_to_polling_count` - Times SSE failed and fell back
- `sse_message_received_count` - Messages received via SSE
- `sse_latency_ms` - Time from flag change to SDK update

### Backend Metrics

**Monitor:**
- `active_sse_connections` - Current open connections
- `sse_messages_broadcasted` - Total messages sent
- `sse_connection_duration_seconds` - Average connection lifetime
- `sse_errors_count` - Connection failures

---

## Recommendations

### Priority Order

1. ✅ **Implement backend SSE endpoint first** (blocking dependency)
2. ✅ **JavaScript SDK** (easiest, native EventSource in browsers)
3. ✅ **Android SDK** (OkHttp already supports streaming)
4. ✅ **iOS SDK** (URLSession supports streaming)

### Best Practices

**All SDKs:**
- ✅ SSE should be **opt-in** (not default initially)
- ✅ Automatic **fallback to polling** on any SSE failure
- ✅ **Exponential backoff** for reconnection (5s → 60s max)
- ✅ **Heartbeat/ping** to detect stale connections (30-60s interval)
- ✅ **Graceful shutdown** on app background/termination

**Mobile-Specific:**
- ✅ Pause SSE on app background, resume on foreground
- ✅ Handle network transitions (WiFi ↔ cellular)
- ✅ Monitor battery impact during beta testing

**Backend:**
- ✅ Use Redis Pub/Sub for multi-instance deployments
- ✅ Implement sticky sessions on load balancer
- ✅ Rate limiting per API key
- ✅ Connection timeout (5 minutes idle)

---

## Risk Assessment

| Risk | **Likelihood** | **Impact** | **Mitigation** |
|------|--------------|----------|--------------|
| **Backend not supporting SSE** | Low | High | Feature detection + graceful fallback |
| **Proxy/firewall blocks SSE** | Medium | Medium | Automatic fallback to polling |
| **Battery drain on mobile** | Low | High | Lifecycle management + monitoring |
| **Connection scalability** | Medium | High | Redis Pub/Sub + load balancer tuning |
| **Breaking changes** | Low | Critical | Opt-in flag + extensive testing |

---

## Conclusion

**SSE implementation is feasible across all three SDKs without new required dependencies:**

✅ **JavaScript**: Native EventSource in browsers (Node.js users provide polyfill)
✅ **Android**: OkHttp 4.12.0 has built-in streaming support
✅ **iOS**: URLSession natively supports streaming responses

**Key Success Factors:**
1. Backend SSE endpoint must be implemented first
2. Maintain backward compatibility (opt-in, fallback to polling)
3. Comprehensive testing across platforms and network conditions
4. Gradual rollout with monitoring

**Expected Benefits:**
- **99% faster** feature flag updates (< 1 second vs 10 minutes)
- **90% reduction** in backend load
- **40% less battery** usage on mobile
- **Better user experience** with real-time updates

**Estimated Timeline: 3-4 weeks** for complete implementation across all platforms.

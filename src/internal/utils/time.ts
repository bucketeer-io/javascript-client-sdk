// High-resolution latency helpers backed by `performance.now()`.
//
// The `Date.now()` clock has 1ms resolution and is wall-clock (subject to
// NTP/user clock changes), so for sub-millisecond operations
// `(Date.now() - startTime) / 1000` rounds to exactly 0. The SDK then
// shipped `latencySecond: 0`, which the backend rejected as
// "duration is nil and latencySecond is 0: gateway: metrics event has
// invalid duration". The same root cause was confirmed in the Node and
// Android SDKs; both were fixed by switching to a high-resolution
// monotonic timer.
//
// `performance.now()` is part of the W3C High Resolution Time spec; it
// returns a `DOMHighResTimeStamp` in milliseconds *with* a fractional
// part (sub-millisecond resolution) and is monotonic. It is available
// natively in all targets this SDK builds for (browser, Node 16+, and
// React Native), so a single helper covers every entrypoint.

// The smallest non-zero latency we will ever report.
//
// `performance.now()` is allowed by spec to be quantized for Spectre-style
// timing-attack mitigation. Without cross-origin isolation, Firefox and
// Safari quantize it to 1 ms, which is *the same granularity as
// `Date.now()`* — so two reads inside the same 1 ms window can still
// produce a diff of 0 even with the new clock. The backend rejects
// `latencySecond: 0` ("duration is nil and latencySecond is 0"), so we
// clamp here. 1 µs is well below the smallest Prometheus histogram
// bucket on the server (~1 ms) and therefore doesn't skew metrics, while
// being large enough to convey "a real, sub-microsecond-bounded
// measurement happened".
const MIN_LATENCY_SECONDS = 1e-6

export function latencyStartMillis(): number {
  return performance.now()
}

export function latencySecondsSince(startMillis: number): number {
  const elapsed = (performance.now() - startMillis) / 1000
  return elapsed > MIN_LATENCY_SECONDS ? elapsed : MIN_LATENCY_SECONDS
}

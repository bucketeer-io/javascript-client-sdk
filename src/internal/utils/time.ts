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

export function latencyStartMillis(): number {
  return performance.now()
}

export function latencySecondsSince(startMillis: number): number {
  return (performance.now() - startMillis) / 1000
}

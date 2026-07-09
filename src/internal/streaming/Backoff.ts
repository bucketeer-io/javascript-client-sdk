import { Clock, DefaultClock } from '../Clock'

const DEFAULT_INITIAL_DELAY_MILLIS = 1_000
const MAX_DELAY_MILLIS = 30_000
const JITTER_RATIO = 0.5
const RESET_INTERVAL_MILLIS = 60_000

export class Backoff {
  private attempt = 0
  private lastSuccessAt = 0

  constructor(
    private readonly initialDelayMillis = DEFAULT_INITIAL_DELAY_MILLIS,
    private readonly maxDelayMillis = MAX_DELAY_MILLIS,
    private readonly resetIntervalMillis = RESET_INTERVAL_MILLIS,
    private readonly clock: Clock = new DefaultClock(),
  ) {}

  // Call when a connection opens successfully.
  success(): void {
    const now = this.clock.currentTimeMillis()
    if (
      this.lastSuccessAt &&
      now - this.lastSuccessAt > this.resetIntervalMillis
    ) {
      this.attempt = 0
    }
    this.lastSuccessAt = now
  }

  // Call to get the delay before the next reconnect attempt.
  nextDelayMillis(): number {
    const base = Math.min(
      this.initialDelayMillis * 2 ** this.attempt,
      this.maxDelayMillis,
    )
    this.attempt++
    return base - Math.trunc(Math.random() * JITTER_RATIO * base)
  }

  reset(): void {
    this.attempt = 0
  }
}

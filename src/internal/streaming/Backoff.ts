const DEFAULT_INITIAL_DELAY_MILLIS = 1_000
const MAX_DELAY_MILLIS = 30_000
const JITTER_RATIO = 0.5

export class Backoff {
  private attempt = 0

  constructor(
    private readonly initialDelayMillis = DEFAULT_INITIAL_DELAY_MILLIS,
    private readonly maxDelayMillis = MAX_DELAY_MILLIS,
  ) {}

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

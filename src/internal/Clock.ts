export interface Clock {
  currentTimeMillis(): number
  currentTimeSeconds(): number
}

export class DefaultClock implements Clock {
  currentTimeMillis(): number {
    return Date.now()
  }

  currentTimeSeconds(): number {
    return Math.floor(this.currentTimeMillis() / 1000)
  }
}

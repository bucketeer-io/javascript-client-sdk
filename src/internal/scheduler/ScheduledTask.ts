export interface ScheduledTask {
  isRunning(): boolean
  start(): void
  stop(): void
}

import { BKTClientImpl } from '../../BKTClient'
import { Component } from '../di/Component'
import { ScheduledTask } from './ScheduledTask'

const RETRY_POLLING_INTERVAL = 1_000 * 60 // 1 minute
const MAX_RETRY_COUNT = 5

export class EvaluationTask implements ScheduledTask {
  constructor(
    private component: Component,
    private retryPollingInterval = RETRY_POLLING_INTERVAL,
    private maxRetryCount = MAX_RETRY_COUNT,
  ) {}

  private timerId?: ReturnType<typeof setTimeout>
  private retryCount = 0
  private running = false

  reschedule(interval: number) {
    clearTimeout(this.timerId)
    // fetchEvaluations call is asynchronous and setInterval does not wait for it.
    // So have to use setTimeout instead.
    this.timerId = setTimeout(() => {
      this.fetchEvaluations()
    }, interval)
  }

  async fetchEvaluations() {
    try {
      await BKTClientImpl.fetchEvaluationsInternal(this.component)

      // success
      this.retryCount = 0
      this.reschedule(this.component.config().pollingInterval)
    } catch {
      // error
      const pollingInterval = this.component.config().pollingInterval
      const isShortInterval = pollingInterval <= this.retryPollingInterval
      const isLongInterval = !isShortInterval

      const canRetry = this.retryCount < this.maxRetryCount && isLongInterval

      if (canRetry) {
        this.retryCount++
        this.reschedule(this.retryPollingInterval)
      } else {
        // we already retried enough, let's get back to daily job
        this.retryCount = 0
        this.reschedule(pollingInterval)
      }
    }
  }

  isRunning(): boolean {
    return this.running
  }

  start(): void {
    this.running = true
    this.reschedule(this.component.config().pollingInterval)
  }
  stop(): void {
    clearTimeout(this.timerId)
    this.running = false
  }
}

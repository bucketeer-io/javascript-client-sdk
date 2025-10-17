import { BKTClientImpl } from '../../BKTClient'
import { Component } from '../di/Component'
import { promiseRetriable, RetryPolicy, ShouldRetryFn } from '../remote/PromiseRetriable'
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
  private running = false

  private reschedule(interval: number) {
    clearTimeout(this.timerId)
    // fetchEvaluations call is asynchronous and setInterval does not wait for it.
    // So have to use setTimeout instead.
    this.timerId = setTimeout(() => {    
      this.fetchEvaluations()
    }, interval)
  }

  async fetchEvaluations() {
    try {
      const retryPolicy: RetryPolicy = {
        maxRetries: this.maxRetryCount,
        delay: this.retryPollingInterval,
        backoffStrategy: 'constant',
      }
      const shouldRetry: ShouldRetryFn = (_: Error): boolean => {
        return this.isRunning()
      }
      if (this.isRunning()) {
        await promiseRetriable(
          () =>
            BKTClientImpl.fetchEvaluationsInternal(this.component),
          retryPolicy,
          shouldRetry,
        )
      }
    } catch {
      // error

    } finally {
      if (this.isRunning()) {
        this.reschedule(this.component.config().pollingInterval)
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

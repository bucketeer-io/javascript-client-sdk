import { BKTClientImpl } from '../../BKTClient'
import { asIllegalStateException, isBKTException } from '../../BKTExceptions'
import { Component } from '../di/Component'
import { EvaluationSyncReporter } from '../evaluation/EvaluationSyncReporter'
import { ScheduledTask } from './ScheduledTask'

const RETRY_POLLING_INTERVAL = 1_000 * 60 // 1 minute
const MAX_RETRY_COUNT = 5

export class EvaluationTask implements ScheduledTask {
  // Read once here: the rest of this class reports the sync status through
  // this field, not through the component.
  private readonly syncReporter: EvaluationSyncReporter

  constructor(
    private component: Component,
    private retryPollingInterval = RETRY_POLLING_INTERVAL,
    private maxRetryCount = MAX_RETRY_COUNT,
  ) {
    this.syncReporter = component.pollingSyncReporter()
  }

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
      if (!this.running) return // guard: stop() may have run while this was in flight
      this.syncReporter.reportSuccess()
      // A listener may have destroyed the client (stop() ran).
      if (!this.running) return

      // success
      this.retryCount = 0
      this.reschedule(this.component.config().pollingInterval)
    } catch (error) {
      if (!this.running) return // guard: stop() may have run while this was in flight

      // error
      const pollingInterval = this.component.config().pollingInterval
      const isLongInterval = pollingInterval > this.retryPollingInterval
      // If the polling interval is shorter than the retry interval, skip the retry mechanism and reschedule using the default interval
      const canRetry = this.retryCount < this.maxRetryCount && isLongInterval

      if (canRetry) {
        this.retryCount++
        this.reschedule(this.retryPollingInterval)
      } else {
        // No retry is left (or none is used with a short pollingInterval):
        // only now does the sync status get the failure.
        const cause = isBKTException(error)
          ? error
          : asIllegalStateException(error, 'failed when polling')
        this.syncReporter.reportFailure(cause)
        // A listener may have destroyed the client (stop() ran).
        if (!this.running) return
        // we already retried enough, let's get back to daily job
        this.retryCount = 0
        this.reschedule(pollingInterval)
      }
    }
  }

  isRunning(): boolean {
    return this.running
  }

  // immediate = true fetches right away instead of waiting a full
  // pollingInterval. A flag, not a second method — only one caller needs it
  // (StreamingTask's polling fallback).
  start(immediate = false): void {
    this.running = true
    if (immediate) {
      this.fetchEvaluations()
    } else {
      this.reschedule(this.component.config().pollingInterval)
    }
  }
  stop(): void {
    clearTimeout(this.timerId)
    this.running = false
  }
}

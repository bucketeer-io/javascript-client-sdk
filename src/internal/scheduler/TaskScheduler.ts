import { Component } from '../di/Component'
import { StreamingTask } from '../streaming/StreamingTask'
import { EvaluationTask } from './EvaluationTask'
import { EventTask } from './EventTask'
import { ScheduledTask } from './ScheduledTask'

// Coalesces a burst of updateUserAttributes() calls (e.g. several attributes
// set at login) into a single reconnect() instead of one per call.
const RECONNECT_STREAMING_DEBOUNCE_MILLIS = 200

export class TaskScheduler {
  private schedulers: ScheduledTask[]
  private reconnectStreamingTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(private component: Component) {
    const mainTask = this.component.config().enableStreaming
      ? new StreamingTask(this.component)
      : new EvaluationTask(this.component)
    this.schedulers = [mainTask, new EventTask(this.component)]
  }

  start() {
    for (const scheduler of this.schedulers) {
      // A sync status listener can call destroyBKTClient() while a task
      // starts (for example on a stream setup failure). Start no more tasks
      // after that, or they would keep running with no owner to stop them.
      if (this.stopped) return
      scheduler.start()
    }
  }

  stop() {
    this.stopped = true
    this.schedulers.forEach((scheduler) => scheduler.stop())
    clearTimeout(this.reconnectStreamingTimer)
    this.reconnectStreamingTimer = undefined
  }

  // Called by BKTClientImpl.updateUserAttributes when streaming is active.
  // No-op when polling (the find returns nothing). Debounced: harmless if the
  // timer fires after stop() (reconnect() no-ops when not running), but
  // stop() clears it anyway so destroy doesn't leave a timer behind.
  reconnectStreaming(): void {
    const task = this.schedulers.find((s) => s instanceof StreamingTask) as
      | StreamingTask
      | undefined
    if (!task) return
    clearTimeout(this.reconnectStreamingTimer)
    this.reconnectStreamingTimer = setTimeout(() => {
      task.reconnect()
    }, RECONNECT_STREAMING_DEBOUNCE_MILLIS)
  }
}

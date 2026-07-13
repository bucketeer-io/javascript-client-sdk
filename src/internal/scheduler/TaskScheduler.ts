import { Component } from '../di/Component'
import { StreamingTask } from '../streaming/StreamingTask'
import { EvaluationTask } from './EvaluationTask'
import { EventTask } from './EventTask'
import { ScheduledTask } from './ScheduledTask'

export class TaskScheduler {
  private schedulers: ScheduledTask[]

  constructor(private component: Component) {
    const mainTask = this.component.config().enableStreaming
      ? new StreamingTask(this.component)
      : new EvaluationTask(this.component)
    this.schedulers = [mainTask, new EventTask(this.component)]
  }

  start() {
    this.schedulers.forEach((scheduler) => scheduler.start())
  }

  stop() {
    this.schedulers.forEach((scheduler) => scheduler.stop())
  }

  // Called by BKTClientImpl.updateUserAttributes when streaming is active.
  // No-op when polling (the find returns nothing).
  reconnectStreaming(): void {
    const task = this.schedulers.find(
      (s) => s instanceof StreamingTask,
    ) as StreamingTask | undefined
    task?.reconnect()
  }
}

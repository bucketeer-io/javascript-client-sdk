import { Component } from '../di/Component'
import { EvaluationTask } from './EvaluationTask'
import { EventTask } from './EventTask'
import { ScheduledTask } from './ScheduledTask'

export class TaskScheduler {
  private schedulers: ScheduledTask[]

  constructor(private component: Component) {
    this.schedulers = [
      new EvaluationTask(this.component),
      new EventTask(this.component),
    ]
  }

  start() {
    this.schedulers.forEach((scheduler) => scheduler.start())
  }

  stop() {
    this.schedulers.forEach((scheduler) => scheduler.stop())
  }
}

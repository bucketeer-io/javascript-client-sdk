import { Component } from '../di/Component'
import { EventInteractor } from '../event/EventInteractor'
import { ScheduledTask } from './ScheduledTask'

type EventUpdateListener = Parameters<
  EventInteractor['setEventUpdateListener']
>[0]

export class EventTask implements ScheduledTask {
  constructor(private component: Component) {}

  private timerId?: number | NodeJS.Timeout
  private running = false

  private eventUpdateListener: EventUpdateListener = async (_) => {
    // send events if the cache exceeded the limit
    const result = await this.component.eventInteractor().sendEvents(false)
    if (result.type === 'success' && result.sent) {
      // reschedule the background task if event is actually sent.
      this.reschedule()
    }
  }

  reschedule() {
    clearTimeout(this.timerId)
    this.timerId = setTimeout(() => {
      // background task should flush(force-send) events
      this.component
        .eventInteractor()
        .sendEvents(true)
        .then(() => {
          this.reschedule()
        })
    }, this.component.config().eventsFlushInterval)
  }

  isRunning(): boolean {
    return this.running
  }

  start(): void {
    this.running = true
    this.component
      .eventInteractor()
      .setEventUpdateListener(this.eventUpdateListener)
    this.reschedule()
  }

  stop(): void {
    clearTimeout(this.timerId)
    this.running = false
  }
}

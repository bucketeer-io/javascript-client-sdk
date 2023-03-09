import { BKTException } from '../../BKTExceptions'
import { Clock } from '../Clock'
import { IdGenerator } from '../IdGenerator'
import { Evaluation } from '../model/Evaluation'
import { EventType, Event } from '../model/Event'
import { ApiId, MetricsEventType } from '../model/MetricsEventData'
import { User } from '../model/User'
import { ApiClient } from '../remote/ApiClient'
import {
  newBaseEvent,
  newDefaultEvaluationEvent,
  newErrorMetricsData,
  newEvaluationEvent,
  newGoalEvent,
  newLatencyMetricsData,
  newMetadata,
  newMetricsEvent,
  newSizeMetricsData,
} from './EventCreators'
import { EventStorage } from './EventStorage'
import {
  SendEventsFailure,
  SendEventsResult,
  SendEventsSuccess,
} from './SendEventResult'

export class EventInteractor {
  constructor(
    private eventsMaxBatchQueueCount: number,
    private apiClient: ApiClient,
    private eventStorage: EventStorage,
    private clock: Clock,
    private idGenerator: IdGenerator,
    private appVersion: string,
  ) {}

  eventUpdateListener: ((events: Event[]) => void) | null = null

  setEventUpdateListener(listener: ((events: Event[]) => void) | null): void {
    this.eventUpdateListener = listener
  }

  trackEvaluationEvent(
    featureTag: string,
    user: User,
    evaluation: Evaluation,
  ): void {
    this.eventStorage.add({
      id: this.idGenerator.newId(),
      type: EventType.EVALUATION,
      event: newEvaluationEvent(
        newBaseEvent(
          this.clock.currentTimeSeconds(),
          newMetadata(this.appVersion, '', ''),
        ),
        {
          featureId: evaluation.featureId,
          featureVersion: evaluation.featureVersion,
          variationId: evaluation.variationId,
          userId: user.id,
          user,
          reason: evaluation.reason,
          tag: featureTag,
        },
      ),
    })

    this.notifyEventsUpdated()
  }

  trackDefaultEvaluationEvent(
    featureTag: string,
    user: User,
    featureId: string,
  ): void {
    this.eventStorage.add({
      id: this.idGenerator.newId(),
      type: EventType.EVALUATION,
      event: newDefaultEvaluationEvent(
        newBaseEvent(
          this.clock.currentTimeSeconds(),
          newMetadata(this.appVersion, '', ''),
        ),
        {
          featureId,
          featureVersion: 0,
          variationId: '',
          userId: user.id,
          user,
          reason: {
            type: 'CLIENT',
          },
          tag: featureTag,
        },
      ),
    })

    this.notifyEventsUpdated()
  }

  trackGoalEvent(
    featureTag: string,
    user: User,
    goalId: string,
    value: number,
  ): void {
    this.eventStorage.add({
      id: this.idGenerator.newId(),
      type: EventType.GOAL,
      event: newGoalEvent(
        newBaseEvent(
          this.clock.currentTimeSeconds(),
          newMetadata(this.appVersion, '', ''),
        ),
        {
          goalId,
          value,
          userId: user.id,
          user,
          tag: featureTag,
        },
      ),
    })

    this.notifyEventsUpdated()
  }

  trackSuccess(
    apiId: ApiId,
    featureTag: string,
    seconds: number,
    sizeByte: number,
  ): void {
    this.eventStorage.addAll([
      {
        id: this.idGenerator.newId(),
        type: EventType.METRICS,
        event: newMetricsEvent(
          newBaseEvent(
            this.clock.currentTimeSeconds(),
            newMetadata(this.appVersion, '', ''),
          ),
          {
            event: newLatencyMetricsData(apiId, seconds, featureTag),
          },
        ),
      },
      {
        id: this.idGenerator.newId(),
        type: EventType.METRICS,
        event: newMetricsEvent(
          newBaseEvent(
            this.clock.currentTimeSeconds(),
            newMetadata(this.appVersion, '', ''),
          ),
          {
            event: newSizeMetricsData(apiId, sizeByte, featureTag),
          },
        ),
      },
    ])

    this.notifyEventsUpdated()
  }

  trackFailure(apiId: ApiId, featureTag: string, error: BKTException): void {
    this.eventStorage.add({
      id: this.idGenerator.newId(),
      type: EventType.METRICS,
      event: newMetricsEvent(
        newBaseEvent(
          this.clock.currentTimeSeconds(),
          newMetadata(this.appVersion, '', ''),
        ),
        {
          event: newErrorMetricsData(
            apiId,
            error.type ?? MetricsEventType.UnknownError,
            featureTag,
          ),
        },
      ),
    })

    this.notifyEventsUpdated()
  }

  async sendEvents(force = false): Promise<SendEventsResult> {
    const current = this.eventStorage.getAll()

    if (current.length === 0) {
      return {
        type: 'success',
        sent: false,
      } satisfies SendEventsSuccess
    }

    if (!force && current.length < this.eventsMaxBatchQueueCount) {
      return {
        type: 'success',
        sent: false,
      } satisfies SendEventsSuccess
    }

    const sendingEvents = current.slice(0, this.eventsMaxBatchQueueCount)

    const result = await this.apiClient.registerEvents(sendingEvents)

    if (result.type === 'success') {
      const errors = result.value.errors ?? {}
      const deleteIds = sendingEvents
        .map((v) => v.id)
        .filter((id) => {
          const error = errors[id]
          if (!error) return true
          return !error.retriable
        })

      this.eventStorage.deleteByIds(deleteIds)
      return {
        type: 'success',
        sent: true,
      } satisfies SendEventsSuccess
    } else {
      return {
        type: 'failure',
        error: result.error,
      } satisfies SendEventsFailure
    }
  }

  private notifyEventsUpdated(): void {
    const listener = this.eventUpdateListener
    if (listener) {
      const events = this.eventStorage.getAll()
      listener(events)
    }
  }
}

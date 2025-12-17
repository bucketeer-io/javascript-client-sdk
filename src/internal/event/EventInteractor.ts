import { Mutex } from 'async-mutex'
import { BKTException } from '../../BKTExceptions'
import { Clock } from '../Clock'
import { IdGenerator } from '../IdGenerator'
import { Evaluation } from '../model/Evaluation'
import { EventType, Event, MetricsEvent } from '../model/Event'
import { ApiId, MetricsEventType } from '../model/MetricsEventData'
import { SourceId } from '../model/SourceId'
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
import { runWithMutex } from '../mutex'

// Fixed 5-second deduplication window
// Prevents duplicate evaluation events for same user+flag+variation within 5 seconds
const EVALUATION_DEDUP_WINDOW_MILLIS = 5_000

export class EventInteractor {
  // Evaluation event deduplication cache
  // Key format: "userId::featureId::variationId"
  // Value: timestamp when last sent (milliseconds)
  private readonly evaluationCache = new Map<string, number>()

  // Track last cleanup time to prevent excessive cleanup operations
  private lastCleanupTimeMillis = 0

  // Mutex for event storage operations
  private mutex = new Mutex()

  eventUpdateListener: ((events: Event[]) => void) | null = null

  constructor(
    private eventsMaxBatchQueueCount: number,
    private apiClient: ApiClient,
    private eventStorage: EventStorage,
    private clock: Clock,
    private idGenerator: IdGenerator,
    private appVersion: string,
    private userAgent: string,
    private sourceId: SourceId,
    private sdkVersion: string,
  ) {}

  setEventUpdateListener(listener: ((events: Event[]) => void) | null): void {
    this.eventUpdateListener = listener
  }

  /**
   * Removes stale entries from the evaluation cache that are older than the dedup window.
   * This prevents unbounded memory growth in long-running applications.
   * Called periodically (approximately once per dedup window) during evaluation tracking.
   */
  private cleanupStaleEvaluationCache(): void {
    const now = this.clock.currentTimeSeconds() * 1000 // milliseconds
    const cutoffTime = now - EVALUATION_DEDUP_WINDOW_MILLIS

    // Remove entries older than the dedup window
    for (const [key, timestamp] of this.evaluationCache.entries()) {
      if (timestamp < cutoffTime) {
        this.evaluationCache.delete(key)
      }
    }

    this.lastCleanupTimeMillis = now
  }

  async trackEvaluationEvent(
    featureTag: string,
    user: User,
    evaluation: Evaluation,
  ): Promise<void> {
    const now = this.clock.currentTimeSeconds() * 1000 // Convert to milliseconds

    // Periodically cleanup stale cache entries (once per dedup window)
    if (now - this.lastCleanupTimeMillis >= EVALUATION_DEDUP_WINDOW_MILLIS) {
      this.cleanupStaleEvaluationCache()
    }

    // Create deduplication key: user + feature + variation
    // Same combination within dedup window = skip event
    const dedupKey = `${user.id}::${evaluation.featureId}::${evaluation.variationId}`
    const lastSent = this.evaluationCache.get(dedupKey)

    // Check if we already sent this exact evaluation within dedup window
    if (
      lastSent !== undefined &&
      now - lastSent < EVALUATION_DEDUP_WINDOW_MILLIS
    ) {
      // Same user+flag+variation within dedup window → Skip duplicate event
      return
    }

    // Optimistically update cache BEFORE async operations to prevent race conditions
    // This ensures concurrent calls see the updated cache immediately
    this.evaluationCache.set(dedupKey, now)

    try {
      // Create event
      await this.eventStorage.add({
        id: this.idGenerator.newId(),
        type: EventType.EVALUATION,
        event: newEvaluationEvent(
          newBaseEvent(
            this.clock.currentTimeSeconds(),
            newMetadata(this.appVersion, this.userAgent),
            this.sourceId,
            this.sdkVersion,
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

      await this.notifyEventsUpdated()
    } catch (error) {
      // Rollback: Remove cache entry on failure so the event can be retried
      this.evaluationCache.delete(dedupKey)
      // Log error but don't throw - event tracking is best-effort and shouldn't crash the app
      console.error('[Bucketeer] Failed to track evaluation event:', error)
    }
  }

  async trackDefaultEvaluationEvent(
    featureTag: string,
    user: User,
    featureId: string,
  ): Promise<void> {
    const now = this.clock.currentTimeSeconds() * 1000 // Convert to milliseconds

    // Periodically cleanup stale cache entries (once per dedup window)
    if (now - this.lastCleanupTimeMillis >= EVALUATION_DEDUP_WINDOW_MILLIS) {
      this.cleanupStaleEvaluationCache()
    }

    // Create deduplication key for default evaluations
    // variationId is empty string for defaults
    const dedupKey = `${user.id}::${featureId}::`
    const lastSent = this.evaluationCache.get(dedupKey)

    // Check if we already sent this default evaluation within dedup window
    if (
      lastSent !== undefined &&
      now - lastSent < EVALUATION_DEDUP_WINDOW_MILLIS
    ) {
      // Same user+flag+default within dedup window → Skip duplicate event
      return
    }

    // Optimistically update cache BEFORE async operations to prevent race conditions
    // This ensures concurrent calls see the updated cache immediately
    this.evaluationCache.set(dedupKey, now)

    try {
      // Create event
      await this.eventStorage.add({
        id: this.idGenerator.newId(),
        type: EventType.EVALUATION,
        event: newDefaultEvaluationEvent(
          newBaseEvent(
            this.clock.currentTimeSeconds(),
            newMetadata(this.appVersion, this.userAgent),
            this.sourceId,
            this.sdkVersion,
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

      await this.notifyEventsUpdated()
    } catch (error) {
      // Rollback: Remove cache entry on failure so the event can be retried
      this.evaluationCache.delete(dedupKey)
      // Log error but don't throw - event tracking is best-effort and shouldn't crash the app
      console.error(
        '[Bucketeer] Failed to track default evaluation event:',
        error,
      )
    }
  }

  async trackGoalEvent(
    featureTag: string,
    user: User,
    goalId: string,
    value: number,
  ): Promise<void> {
    await this.eventStorage.add({
      id: this.idGenerator.newId(),
      type: EventType.GOAL,
      event: newGoalEvent(
        newBaseEvent(
          this.clock.currentTimeSeconds(),
          newMetadata(this.appVersion, this.userAgent),
          this.sourceId,
          this.sdkVersion,
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

    await this.notifyEventsUpdated()
  }

  async trackSuccess(
    apiId: ApiId,
    featureTag: string,
    seconds: number,
    sizeByte: number,
  ): Promise<void> {
    const metricsEvents: Event[] = [
      {
        id: this.idGenerator.newId(),
        type: EventType.METRICS,
        event: newMetricsEvent(
          newBaseEvent(
            this.clock.currentTimeSeconds(),
            newMetadata(this.appVersion, this.userAgent),
            this.sourceId,
            this.sdkVersion,
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
            newMetadata(this.appVersion, this.userAgent),
            this.sourceId,
            this.sdkVersion,
          ),
          {
            event: newSizeMetricsData(apiId, sizeByte, featureTag),
          },
        ),
      },
    ]

    const added = await this.addMetricsEvents(metricsEvents)

    if (added) {
      await this.notifyEventsUpdated()
    }
  }

  async trackFailure(
    apiId: ApiId,
    featureTag: string,
    error: BKTException,
  ): Promise<void> {
    if (error.type === MetricsEventType.UnauthorizedError) {
      console.error(
        'An unauthorized error occurred. Please check your API Key.',
      )
      return
    }

    if (error.type === MetricsEventType.ForbiddenError) {
      console.error('An forbidden error occurred. Please check your API Key.')
      return
    }

    const metricsEvents: Event[] = [
      {
        id: this.idGenerator.newId(),
        type: EventType.METRICS,
        event: newMetricsEvent(
          newBaseEvent(
            this.clock.currentTimeSeconds(),
            newMetadata(this.appVersion, this.userAgent),
            this.sourceId,
            this.sdkVersion,
          ),
          {
            event: newErrorMetricsData(apiId, error, featureTag),
          },
        ),
      },
    ]

    const added = await this.addMetricsEvents(metricsEvents)

    if (added) {
      await this.notifyEventsUpdated()
    }
  }

  async sendEvents(force = false): Promise<SendEventsResult> {
    return runWithMutex(this.mutex, async () => {
      return this.sendEventsInternal(force)
    })
  }

  private async sendEventsInternal(force = false): Promise<SendEventsResult> {
    const current = await this.eventStorage.getAll()

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

      await this.eventStorage.deleteByIds(deleteIds)
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

  private async notifyEventsUpdated(): Promise<void> {
    const listener = this.eventUpdateListener
    if (listener) {
      const events = await this.eventStorage.getAll()
      listener(events)
    }
  }

  /**
   * !!VISIBLE FOR TESTING!!
   * get unique key for MetricsEvent
   *
   * @param event
   * @returns
   */
  getMetricsEventUniqueKey(event: MetricsEvent): string {
    return `${event.event.apiId}::${event.event['@type']}`
  }

  /**
   * !!VISIBLE FOR TESTING!!
   *
   * Filter duplicate metric events by finding existing metrics events on the cache database fist,
   * then remove all new duplicate metrics events, only add new metrics event
   *
   * @param events array of Event
   * @returns true if new metrics events added, false otherwise
   */
  async addMetricsEvents(events: Event[]): Promise<boolean> {
    const storedEvents = await this.eventStorage.getAll()
    const metricsEventUniqueKeys: string[] = storedEvents
      .filter((v) => v.type === EventType.METRICS)
      .map((v) => this.getMetricsEventUniqueKey(v.event as MetricsEvent))

    const newEvents = events.filter(
      (v) =>
        v.type === EventType.METRICS &&
        !metricsEventUniqueKeys.includes(
          this.getMetricsEventUniqueKey(v.event as MetricsEvent),
        ),
    )

    if (newEvents.length > 0) {
      await this.eventStorage.addAll(newEvents)
      return true
    }

    return false
  }
}

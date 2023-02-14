import {
  GetEvaluationLatencyMetricsEvent,
  GetEvaluationSizeMetricsEvent,
  InternalErrorCountMetricsEvent,
  TimeoutErrorCountMetricsEvent,
} from './MetricsEventData'
import { MetricsEventType } from './MetricsEventType'
import { Reason } from './Reason'
import { SourceID } from './SourceID'
import { User } from './User'

export const EventType = {
  GOAL: 1,
  GOAL_BATCH: 2,
  EVALUATION: 3,
  METRICS: 4,
} as const
export type EventType = typeof EventType[keyof typeof EventType]

export interface GoalEvent {
  timestamp: number
  goalId: string
  userId: string
  value: number
  user: User
  tag: string
  sourceId: SourceID
  sdkVersion: string
  metadata: Record<string, string>
}

export interface EvaluationEvent {
  timestamp: number
  featureId: string
  featureVersion: number
  userId: string
  variationId: string
  user: User
  reason: Reason
  tag: string
  sourceId: SourceID
  sdkVersion: string
  metadata: Record<string, string>
}

export type MetricsEvent =
  | {
      timestamp: number
      type: typeof MetricsEventType['GET_EVALUATION_LATENCY']
      event: GetEvaluationLatencyMetricsEvent
      sdkVersion: string
      metadata: Record<string, string>
    }
  | {
      timestamp: number
      type: typeof MetricsEventType['GET_EVALUATION_SIZE']
      event: GetEvaluationSizeMetricsEvent
      sdkVersion: string
      metadata: Record<string, string>
    }
  | {
      timestamp: number
      type: typeof MetricsEventType['TIMEOUT_ERROR_COUNT']
      event: TimeoutErrorCountMetricsEvent
      sdkVersion: string
      metadata: Record<string, string>
    }
  | {
      timestamp: number
      type: typeof MetricsEventType['INTERNAL_ERROR_COUNT']
      event: InternalErrorCountMetricsEvent
      sdkVersion: string
      metadata: Record<string, string>
    }

export type Event =
  | {
      id: string
      type: typeof EventType['GOAL']
      event: GoalEvent
    }
  // type: 2 is not for client
  | {
      id: string
      type: typeof EventType['EVALUATION']
      event: EvaluationEvent
    }
  | {
      id: string
      type: typeof EventType['METRICS']
      event: MetricsEvent
    }

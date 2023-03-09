import { MetricsEventData } from './MetricsEventData'
import { Reason } from './Reason'
import { SourceID } from './SourceID'
import { User } from './User'

export const EventType = {
  GOAL: 1,
  GOAL_BATCH: 2,
  EVALUATION: 3,
  METRICS: 4,
} as const
export type EventType = (typeof EventType)[keyof typeof EventType]

export interface BaseEvent {
  timestamp: number
  sourceId: SourceID
  sdkVersion: string
  metadata: Record<string, string>
}

export interface GoalEvent extends BaseEvent {
  goalId: string
  value: number
  userId: string
  user: User
  tag: string
}

export interface EvaluationEvent extends BaseEvent {
  featureId: string
  featureVersion: number
  variationId: string
  userId: string
  user: User
  reason: Reason
  tag: string
}

export interface MetricsEvent extends BaseEvent {
  event: MetricsEventData
}

export type Event =
  | {
      id: string
      type: (typeof EventType)['GOAL']
      event: GoalEvent
    }
  // type: 2 is not for client
  | {
      id: string
      type: (typeof EventType)['EVALUATION']
      event: EvaluationEvent
    }
  | {
      id: string
      type: (typeof EventType)['METRICS']
      event: MetricsEvent
    }

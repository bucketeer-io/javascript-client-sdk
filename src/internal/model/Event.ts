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

export type MetricsEvent = {
  timestamp: number
  event: MetricsEventData
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

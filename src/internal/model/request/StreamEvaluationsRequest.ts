import { SourceId } from '../SourceId'

export interface StreamEvaluationsRequest {
  tag: string
  user: { id: string; data?: Record<string, string> }
  sourceId: SourceId
  sdkVersion: string
  // Last-known state, so the backend can send a diff instead of a full
  // snapshot on (re)connect — same mechanism as the polling path's
  // UserEvaluationCondition. Empty string / '0' (the proto3 zero values) on
  // the first connect, before any state has been cached.
  userEvaluationsId: string
  evaluatedAt: string
}

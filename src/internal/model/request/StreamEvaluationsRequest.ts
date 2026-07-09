import { SourceId } from '../SourceId'

export interface StreamEvaluationsRequest {
  tag: string
  user: { id: string; data?: Record<string, string> }
  sourceId: SourceId
  sdkVersion: string
}

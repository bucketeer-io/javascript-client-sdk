import { Event } from '../Event'
import { SourceId } from '../SDKSourceId'

export interface RegisterEventsRequest {
  events: Event[]
  sdkVersion: string
  sourceId: SourceId
}

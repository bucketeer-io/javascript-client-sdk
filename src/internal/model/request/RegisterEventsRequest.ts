import { Event } from '../Event'
import { SourceId } from '../SourceId'

export interface RegisterEventsRequest {
  events: Event[]
  sdkVersion: string
  sourceId: SourceId
}

import { Event } from '../Event'
import { SourceId } from '../SourceID'

export interface RegisterEventsRequest {
  events: Event[]
  sdkVersion: string
  sourceId: SourceId
}

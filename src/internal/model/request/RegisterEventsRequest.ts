import { Event } from '../Event'
import { SourceID } from '../SourceID'

export interface RegisterEventsRequest {
  events: Event[]
  sdkVersion: string
  sourceId: SourceID
}

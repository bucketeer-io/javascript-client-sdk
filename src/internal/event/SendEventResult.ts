import { BKTException } from '../../BKTExceptions'

export interface SendEventsSuccess {
  type: 'success'
  sent: boolean
}

export interface SendEventsFailure {
  type: 'failure'
  error: BKTException
}

export type SendEventsResult = SendEventsSuccess | SendEventsFailure

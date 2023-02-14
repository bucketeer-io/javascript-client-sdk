import { BKTException } from '../../BKTExceptions'
import { RegisterEventsResponse } from '../model/response/RegisterEventsResponse'

export interface RegisterEventsSuccess {
  type: 'success'
  value: RegisterEventsResponse
}

export interface RegisterEventsFailure {
  type: 'failure'
  error: BKTException
}

export type RegisterEventsResult = RegisterEventsSuccess | RegisterEventsFailure

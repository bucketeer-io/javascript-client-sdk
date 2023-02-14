import { RegisterEventsErrorResponse } from './RegisterEventsErrorResponse'

export interface RegisterEventsResponse {
  errors?: Record<string, RegisterEventsErrorResponse>
}

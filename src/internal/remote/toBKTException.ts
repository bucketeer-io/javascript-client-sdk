import {
  BadRequestException,
  BKTException,
  ClientClosedRequestException,
  ForbiddenException,
  InternalServerErrorException,
  InvalidHttpMethodException,
  NotFoundException,
  PayloadTooLargeException,
  RedirectRequestException,
  ServiceUnavailableException,
  TimeoutException,
  UnauthorizedException,
  UnknownException,
} from '../../BKTExceptions'
import { MetricsEventType } from '../model/MetricsEventData'
import { ErrorResponse } from '../model/response/ErrorResponse'
import { FetchResponseLike } from './fetch'

export const addTimeoutValueIfNeeded = (
  exception: BKTException,
  timeoutMillis: number,
): BKTException => {
  if (exception.type === MetricsEventType.TimeoutError) {
    return new TimeoutException(timeoutMillis, exception.message)
  }
  return exception
}

export const toBKTException = async (
  response: FetchResponseLike,
): Promise<BKTException> => {
  const responseText: string = await response.text()
  const errorBody: ErrorResponse | null = (() => {
    try {
      return JSON.parse(responseText)
    } catch {
      return null
    }
  })()
  const { message = responseText } = errorBody?.error ?? {}

  const status = response.status
  return statusToBKTException(
    status,
    message,
    `Unknown Error: ${status} ${response.statusText}, ${responseText} ,${JSON.stringify(errorBody)}`,
  )
}

// Maps an HTTP status to a BKTException. Polling (toBKTException) and
// streaming both use it, so the same status always gives the same class.
export const statusToBKTException = (
  status: number,
  message?: string,
  // The message for a status with no class of its own.
  unknownMessage?: string,
): BKTException => {
  switch (true) {
    case status >= 300 && status < 400:
      return new RedirectRequestException(status, message ?? 'Redirect Request')
    case status == 400:
      return new BadRequestException(message ?? 'Bad Request')
    case status == 401:
      return new UnauthorizedException(message ?? 'Unauthorized')
    case status == 403:
      return new ForbiddenException(message ?? 'Forbidden')
    case status == 404:
      return new NotFoundException(message ?? 'Feature Not Found')
    case status == 405:
      return new InvalidHttpMethodException(message ?? 'Invalid HTTP Method')
    case status == 408:
      return new TimeoutException(0, message ?? 'Timeout with status 408')
    case status == 413:
      return new PayloadTooLargeException(message ?? 'Payload Too Large')
    case status == 499:
      return new ClientClosedRequestException(
        message ?? 'Client Closed Request',
      )
    case status == 500:
      return new InternalServerErrorException(
        message ?? 'Internal Server Error',
      )
    case [502, 503, 504].includes(status):
      return new ServiceUnavailableException(message ?? 'Service Unavailable')
    default:
      return new UnknownException(
        unknownMessage ?? `Unknown Error: ${status}`,
        status,
      )
  }
}

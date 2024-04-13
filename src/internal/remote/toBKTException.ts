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

export const copyTimeout = (
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
    } catch (e) {
      return null
    }
  })()
  const { message = responseText } = errorBody?.error ?? {}

  const status = response.status
  switch (status) {
    case 400:
      return new BadRequestException(message ?? 'Bad Request')
    case 401:
      return new UnauthorizedException(message ?? 'Unauthorized')
    case 403:
      return new ForbiddenException(message ?? 'Forbidden')
    case 404:
      return new NotFoundException(message ?? 'Feature Not Found')
    case 405:
      return new InvalidHttpMethodException(message ?? 'Invalid HTTP Method')
    case 408:
      return new TimeoutException(0, message ?? 'Timeout with status 408')
    case 413:
      return new PayloadTooLargeException(message ?? 'Payload Too Large')
    case 499:
      return new ClientClosedRequestException(
        message ?? 'Client Closed Request',
      )
    case 500:
      return new InternalServerErrorException(
        message ?? 'Internal Server Error',
      )
    case 502:
    case 503:
    case 504:
      return new ServiceUnavailableException(message ?? 'Service Unavailable')
    default:
      if (status >= 300 && status < 400) {
        return new RedirectRequestException(
          response.status,
          message ?? 'Redirect Request',
        )
      }
      return new UnknownException(
        `Unknown Error: ${response.status} ${
          response.statusText
        }, ${JSON.stringify(errorBody)}`,
        response.status,
      )
  }
}

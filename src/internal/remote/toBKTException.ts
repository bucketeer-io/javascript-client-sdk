import {
  BadRequestException,
  BKTException,
  ClientClosedRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnknownException,
} from '../../BKTExceptions'
import { ErrorResponse } from '../model/response/ErrorResponse'
import { FetchResponseLike } from './fetch'

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

  switch (response.status) {
    case 400:
      return new BadRequestException(message ?? 'Bad Request')
    case 401:
      return new UnauthorizedException(message ?? 'Unauthorized')
    case 403:
      return new ForbiddenException(message ?? 'Forbidden')
    case 404:
      return new NotFoundException(message ?? 'Feature Not Found')
    case 499:
      return new ClientClosedRequestException(
        message ?? 'Client Closed Request',
      )
    case 500:
      return new InternalServerErrorException(
        message ?? 'Internal Server Error',
      )
    case 503:
      return new ServiceUnavailableException(message ?? 'Service Unavailable')
    default:
      return new UnknownException(
        `Unknown Error: ${response.status} ${
          response.statusText
        }, ${JSON.stringify(errorBody)}`,
      )
  }
}

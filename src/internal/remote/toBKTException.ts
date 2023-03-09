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
  const errorBody: ErrorResponse | null = await response.json()
  const error = errorBody?.error

  switch (response.status) {
    case 400:
      return new BadRequestException(error?.message ?? 'Bad Request')
    case 401:
      return new UnauthorizedException(error?.message ?? 'Unauthorized')
    case 403:
      return new ForbiddenException(error?.message ?? 'Forbidden')
    case 404:
      return new NotFoundException(error?.message ?? 'Feature Not Found')
    case 499:
      return new ClientClosedRequestException(
        error?.message ?? 'Client Closed Request',
      )
    case 500:
      return new InternalServerErrorException(
        error?.message ?? 'Internal Server Error',
      )
    case 503:
      return new ServiceUnavailableException(
        error?.message ?? 'Service Unavailable',
      )
    default:
      return new UnknownException(
        `Unknown Error: ${response.status} ${
          response.statusText
        }, ${JSON.stringify(errorBody)}`,
      )
  }
}

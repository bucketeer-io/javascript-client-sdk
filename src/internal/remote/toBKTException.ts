import { ApiServerException, BadRequestException, BKTException, FeatureNotFoundException, InvalidHttpMethodException, UnauthorizedException, UnknownException } from '../../BKTExceptions'
import { ErrorResponse } from '../model/response/ErrorResponse'
import { FetchResponseLike } from './fetch'

export const toBKTException = async (response: FetchResponseLike): Promise<BKTException> => {
  const errorBody: ErrorResponse | null = await response.json()
  const error = errorBody?.error

  switch (response.status) {
  case 400:
    return new BadRequestException(error?.message ?? 'Bad Request')
  case 401:
    return new UnauthorizedException(error?.message ?? 'Unauthorized')
  case 404:
    return new FeatureNotFoundException(error?.message ?? 'Feature Not Found')
  case 405:
    return new InvalidHttpMethodException(error?.message ?? 'Invalid HTTP Method')
  case 500:
    return new ApiServerException(error?.message ?? 'Internal Server Error')
  default:
    return new UnknownException(`Unknown Error: ${response.status} ${response.statusText}, ${JSON.stringify(errorBody)}`)
  }
}

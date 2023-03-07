import { ErrorMetricsEventType, MetricsEventType } from './internal/model/MetricsEventData'

abstract class BKTBaseException extends Error {
  type?: ErrorMetricsEventType = undefined
  constructor(msg?: string) {
    super(msg)
    this.name = new.target.name
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// server errors ---
// 400: Bad Request
export class BadRequestException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.BadRequestError
}
// 401: Unauthorized
export class UnauthorizedException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.UnauthorizedError
}
// 403: Forbidden
export class ForbiddenException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.ForbiddenError
}
// 404: NotFound
export class NotFoundException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.NotFoundError
}
// 499: Client Closed Request
export class ClientClosedRequestException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.ClientClosedRequestError
}
// 500: Internal Server Error
export class InternalServerErrorException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.InternalServerError
}
// 503: Service Unavailable
export class ServiceUnavailableException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.ServiceUnavailableError
}


// network errors
export class TimeoutException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.TimeoutError
}
export class NetworkException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.NetworkError
}

// sdk errors
export class IllegalArgumentException extends BKTBaseException {}
export class IllegalStateException extends BKTBaseException {}

// unknown errors
export class UnknownException extends BKTBaseException {}

export type BKTException = BadRequestException | UnauthorizedException | ForbiddenException | NotFoundException | ClientClosedRequestException | InternalServerErrorException | ServiceUnavailableException | TimeoutException | NetworkException | IllegalArgumentException | IllegalStateException | UnknownException

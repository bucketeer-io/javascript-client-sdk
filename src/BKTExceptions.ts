import {
  ErrorMetricsEventType,
  MetricsEventType,
} from './internal/model/MetricsEventData'

abstract class BKTBaseException extends Error {
  type?: ErrorMetricsEventType = undefined
  constructor(msg?: string) {
    super(msg)
    this.name = new.target.name
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// server redirect 300..399
export class RedirectRequestException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.RedirectRequestError
  statusCode: number

  constructor(statusCode: number, msg?: string) {
    super(msg)
    this.statusCode = statusCode
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
// 405: InvalidHttpMethod
export class InvalidHttpMethodException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.InternalSdkError
}
// 413: Payload Too Large
export class PayloadTooLargeException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.PayloadTooLargeError
}
// 499: Client Closed Request
export class ClientClosedRequestException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.ClientClosedRequestError
}
// 500: Internal Server Error
export class InternalServerErrorException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.InternalServerError
}
// 502, 503, 504: Service Unavailable
export class ServiceUnavailableException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.ServiceUnavailableError
}

// network errors
export class TimeoutException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.TimeoutError
  timeoutMillis: number

  constructor(timeoutMillis: number, msg?: string) {
    super(msg)
    this.timeoutMillis = timeoutMillis
  }
}
export class NetworkException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.NetworkError
}

// sdk errors
export class IllegalArgumentException extends BKTBaseException {}
export class IllegalStateException extends BKTBaseException {}

// unknown errors
export class UnknownException extends BKTBaseException {
  type?: ErrorMetricsEventType = MetricsEventType.UnknownError
  statusCode?: number

  constructor(msg?: string, statusCode?: number) {
    super(msg)
    this.statusCode = statusCode
  }
}

export type BKTException =
  | BadRequestException
  | UnauthorizedException
  | ForbiddenException
  | NotFoundException
  | ClientClosedRequestException
  | InternalServerErrorException
  | ServiceUnavailableException
  | TimeoutException
  | NetworkException
  | IllegalArgumentException
  | IllegalStateException
  | UnknownException
  | InvalidHttpMethodException
  | PayloadTooLargeException
  | RedirectRequestException

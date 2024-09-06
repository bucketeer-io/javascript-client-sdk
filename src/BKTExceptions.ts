import {
  ErrorMetricsEventType,
  MetricsEventType,
} from './internal/model/MetricsEventData'

abstract class BKTBaseException extends Error {
  name = 'BKTBaseException'
  type?: ErrorMetricsEventType = undefined
  constructor(msg?: string) {
    super(msg)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// server redirect 300..399
export class RedirectRequestException extends BKTBaseException {
  name = 'RedirectRequestException' as const
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
  name = 'BadRequestException' as const
  type?: ErrorMetricsEventType = MetricsEventType.BadRequestError
}
// 401: Unauthorized
export class UnauthorizedException extends BKTBaseException {
  name = 'UnauthorizedException' as const
  type?: ErrorMetricsEventType = MetricsEventType.UnauthorizedError
}
// 403: Forbidden
export class ForbiddenException extends BKTBaseException {
  name = 'ForbiddenException' as const
  type?: ErrorMetricsEventType = MetricsEventType.ForbiddenError
}
// 404: NotFound
export class NotFoundException extends BKTBaseException {
  name = 'NotFoundException' as const
  type?: ErrorMetricsEventType = MetricsEventType.NotFoundError
}
// 405: InvalidHttpMethod
export class InvalidHttpMethodException extends BKTBaseException {
  name = 'InvalidHttpMethodException' as const
  type?: ErrorMetricsEventType = MetricsEventType.InternalSdkError
}
// 413: Payload Too Large
export class PayloadTooLargeException extends BKTBaseException {
  name = 'PayloadTooLargeException' as const
  type?: ErrorMetricsEventType = MetricsEventType.PayloadTooLargeError
}
// 499: Client Closed Request
export class ClientClosedRequestException extends BKTBaseException {
  name = 'ClientClosedRequestException' as const
  type?: ErrorMetricsEventType = MetricsEventType.ClientClosedRequestError
}
// 500: Internal Server Error
export class InternalServerErrorException extends BKTBaseException {
  name = 'InternalServerErrorException' as const
  type?: ErrorMetricsEventType = MetricsEventType.InternalServerError
}
// 502, 503, 504: Service Unavailable
export class ServiceUnavailableException extends BKTBaseException {
  name = 'ServiceUnavailableException' as const
  type?: ErrorMetricsEventType = MetricsEventType.ServiceUnavailableError
}

// network errors
export class TimeoutException extends BKTBaseException {
  name = 'TimeoutException' as const
  type?: ErrorMetricsEventType = MetricsEventType.TimeoutError
  timeoutMillis: number

  constructor(timeoutMillis: number, msg?: string) {
    super(msg)
    this.timeoutMillis = timeoutMillis
  }
}
export class NetworkException extends BKTBaseException {
  name = 'NetworkException' as const
  type?: ErrorMetricsEventType = MetricsEventType.NetworkError
}

// sdk errors
export class IllegalArgumentException extends BKTBaseException {
  name = 'IllegalArgumentException' as const
}
export class IllegalStateException extends BKTBaseException {
  name = 'IllegalStateException' as const
}

// unknown errors
export class UnknownException extends BKTBaseException {
  name = 'UnknownException' as const
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

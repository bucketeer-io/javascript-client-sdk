abstract class ExtensibleCustomError extends Error {
  constructor(msg?: string) {
    super(msg)
    this.name = new.target.name
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// server errors ---
// 400: Bad Request
export class BadRequestException extends ExtensibleCustomError {}
// 401: Unauthorized
export class UnauthorizedException extends ExtensibleCustomError {}
// 403: Forbidden
export class ForbiddenException extends ExtensibleCustomError {}
// 404: NotFound
export class NotFoundException extends ExtensibleCustomError {}
// 499: Client Closed Request
export class ClientClosedRequestException extends ExtensibleCustomError {}
// 500: Internal Server Error
export class InternalServerErrorException extends ExtensibleCustomError {}
// 503: Service Unavailable
export class ServiceUnavailableException extends ExtensibleCustomError {}


// network errors
export class TimeoutException extends ExtensibleCustomError {}
export class NetworkException extends ExtensibleCustomError {}

// sdk errors
export class IllegalArgumentException extends ExtensibleCustomError {}
export class IllegalStateException extends ExtensibleCustomError {}

// unknown errors
export class UnknownException extends ExtensibleCustomError {}

export type BKTException = BadRequestException | UnauthorizedException | ForbiddenException | NotFoundException | ClientClosedRequestException | InternalServerErrorException | ServiceUnavailableException | TimeoutException | NetworkException | IllegalArgumentException | IllegalStateException | UnknownException

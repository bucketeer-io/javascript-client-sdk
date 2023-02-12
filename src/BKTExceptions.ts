abstract class ExtensibleCustomError extends Error {
  constructor(msg?: string) {
    super(msg)
    this.name = new.target.name
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// server errors
export class BadRequestException extends ExtensibleCustomError {}
export class UnauthorizedException extends ExtensibleCustomError {}
export class FeatureNotFoundException extends ExtensibleCustomError {}
export class InvalidHttpMethodException extends ExtensibleCustomError {}
export class ApiServerException extends ExtensibleCustomError {}

// network errors
export class TimeoutException extends ExtensibleCustomError {}
export class NetworkException extends ExtensibleCustomError {}

// sdk errors
export class IllegalArgumentException extends ExtensibleCustomError {}
export class IllegalStateException extends ExtensibleCustomError {}

// unknown errors
export class UnknownException extends ExtensibleCustomError {}

export type BKTException = BadRequestException | UnauthorizedException | FeatureNotFoundException | InvalidHttpMethodException | ApiServerException | TimeoutException | NetworkException | IllegalArgumentException | IllegalStateException | UnknownException

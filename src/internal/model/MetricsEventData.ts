export const ApiId = {
  UNKNOWN_API: 0,
  GET_EVALUATION: 1,
  GET_EVALUATIONS: 2,
  REGISTER_EVENTS: 3,
} as const
export type ApiId = (typeof ApiId)[keyof typeof ApiId]

export const MetricsEventType = {
  LatencyMetrics:
    'type.googleapis.com/bucketeer.event.client.LatencyMetricsEvent',
  SizeMetrics: 'type.googleapis.com/bucketeer.event.client.SizeMetricsEvent',
  RedirectRequestError:
    'type.googleapis.com/bucketeer.event.client.RedirectionRequestExceptionEvent',
  BadRequestError:
    'type.googleapis.com/bucketeer.event.client.BadRequestErrorMetricsEvent',
  UnauthorizedError:
    'type.googleapis.com/bucketeer.event.client.UnauthorizedErrorMetricsEvent',
  ForbiddenError:
    'type.googleapis.com/bucketeer.event.client.ForbiddenErrorMetricsEvent',
  NotFoundError:
    'type.googleapis.com/bucketeer.event.client.NotFoundErrorMetricsEvent',
  PayloadTooLargeError:
    'type.googleapis.com/bucketeer.event.client.PayloadTooLargeExceptionEvent',
  ClientClosedRequestError:
    'type.googleapis.com/bucketeer.event.client.ClientClosedRequestErrorMetricsEvent',
  InternalServerError:
    'type.googleapis.com/bucketeer.event.client.InternalServerErrorMetricsEvent',
  ServiceUnavailableError:
    'type.googleapis.com/bucketeer.event.client.ServiceUnavailableErrorMetricsEvent',
  InternalSdkError:
    'type.googleapis.com/bucketeer.event.client.InternalSdkErrorMetricsEvent',
  TimeoutError:
    'type.googleapis.com/bucketeer.event.client.TimeoutErrorMetricsEvent',
  NetworkError:
    'type.googleapis.com/bucketeer.event.client.NetworkErrorMetricsEvent',
  UnknownError:
    'type.googleapis.com/bucketeer.event.client.UnknownErrorMetricsEvent',
} as const
export type MetricsEventType =
  (typeof MetricsEventType)[keyof typeof MetricsEventType]

export type ErrorMetricsEventType = Exclude<
  MetricsEventType,
  | (typeof MetricsEventType)['LatencyMetrics']
  | (typeof MetricsEventType)['SizeMetrics']
>

export interface LatencyMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  latencySecond: number
  '@type': (typeof MetricsEventType)['LatencyMetrics']
}

export interface SizeMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  sizeByte: number
  '@type': (typeof MetricsEventType)['SizeMetrics']
}

// 400: Bad Request
export interface BadRequestErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['BadRequestError']
}

// 401: Unauthorized
export interface UnauthorizedErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['UnauthorizedError']
}

// 403: Forbidden
export interface ForbiddenErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['ForbiddenError']
}

// 404: NotFound
export interface NotFoundErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['NotFoundError']
}

// 499: Client Closed Request
export interface ClientClosedRequestMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['ClientClosedRequestError']
}

// 500: Internal Server Error
export interface InternalServerErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['InternalServerError']
}

// 502, 503, 504: Service Unavailable
export interface ServiceUnavailableErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['ServiceUnavailableError']
}

export interface TimeoutErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['TimeoutError']
}

export interface NetworkErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['NetworkError']
}

export interface InternalSdkErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['InternalSdkError']
}

export interface UnknownErrorMetricsEvent {
  apiId: ApiId
  labels: Record<string, string>
  '@type': (typeof MetricsEventType)['UnknownError']
}

export type MetricsEventData =
  | LatencyMetricsEvent
  | SizeMetricsEvent
  | BadRequestErrorMetricsEvent
  | UnauthorizedErrorMetricsEvent
  | ForbiddenErrorMetricsEvent
  | NotFoundErrorMetricsEvent
  | ClientClosedRequestMetricsEvent
  | InternalServerErrorMetricsEvent
  | ServiceUnavailableErrorMetricsEvent
  | TimeoutErrorMetricsEvent
  | NetworkErrorMetricsEvent
  | InternalSdkErrorMetricsEvent
  | UnknownErrorMetricsEvent

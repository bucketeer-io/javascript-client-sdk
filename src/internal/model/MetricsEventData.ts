export interface GetEvaluationLatencyMetricsEvent {
  labels: Record<string, string>
  duration: number
}

export interface GetEvaluationSizeMetricsEvent {
  labels: Record<string, string>
  size_byte: number
}

export interface TimeoutErrorCountMetricsEvent {
  tag: string
}

export interface InternalErrorCountMetricsEvent {
  tag: string
}

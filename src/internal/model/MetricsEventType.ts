export const MetricsEventType = {
  GET_EVALUATION_LATENCY: 1,
  GET_EVALUATION_SIZE: 2,
  TIMEOUT_ERROR_COUNT: 3,
  INTERNAL_ERROR_COUNT: 4,
} as const
export type MetricsEventType = typeof MetricsEventType[keyof typeof MetricsEventType]

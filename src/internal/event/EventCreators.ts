import {
  EvaluationEvent,
  GoalEvent,
  MetricsEvent,
  BaseEvent,
  RootEventType,
} from '../model/Event'
import {
  ApiId,
  ErrorMetricsEventType,
  LatencyMetricsEvent,
  MetricsEventData,
  MetricsEventType,
  SizeMetricsEvent,
} from '../model/MetricsEventData'
import { SourceID } from '../model/SourceID'

export const newMetadata = (
  appVersion: string,
  // osVersion: string,
  deviceModel: string,
): Record<string, string> => {
  return {
    appVersion,
    // osVersion, osVersion is not available in javascript-client-sdk
    deviceModel,
  }
}

export const newBaseEvent = (
  timestamp: number,
  metadata: Record<string, string>,
): BaseEvent => {
  return {
    timestamp,
    sourceId: SourceID.JAVASCRIPT,
    sdkVersion: __BKT_SDK_VERSION__,
    metadata,
  }
}

export const newEvaluationEvent = (
  base: BaseEvent,
  fields: Omit<EvaluationEvent, keyof BaseEvent | '@type'>,
): EvaluationEvent => {
  return {
    ...base,
    ...fields,
    '@type': RootEventType.EvaluationEvent,
  }
}

export const newDefaultEvaluationEvent = (
  base: BaseEvent,
  fields: Omit<EvaluationEvent, keyof BaseEvent | '@type'>,
): EvaluationEvent => {
  return {
    ...base,
    ...fields,
    '@type': RootEventType.EvaluationEvent,
  }
}

export const newGoalEvent = (
  base: BaseEvent,
  fields: Omit<GoalEvent, keyof BaseEvent | '@type'>,
): GoalEvent => {
  return {
    ...base,
    ...fields,
    '@type': RootEventType.GoalEvent,
  }
}

export const newLatencyMetricsData = (
  apiId: ApiId,
  duration: number,
  featureTag: string,
): LatencyMetricsEvent => {
  return {
    apiId,
    labels: { tag: featureTag },
    duration: { value: duration },
    '@type': MetricsEventType.LatencyMetrics,
  }
}

export const newSizeMetricsData = (
  apiId: ApiId,
  sizeByte: number,
  featureTag: string,
): SizeMetricsEvent => {
  return {
    apiId,
    labels: { tag: featureTag },
    sizeByte,
    '@type': MetricsEventType.SizeMetrics,
  }
}

export const newErrorMetricsData = (
  apiId: ApiId,
  type: ErrorMetricsEventType,
  featureTag: string,
): MetricsEventData => {
  return {
    apiId,
    labels: { tag: featureTag },
    '@type': type,
  }
}

export const newMetricsEvent = (
  base: BaseEvent,
  fields: Omit<MetricsEvent, keyof BaseEvent | '@type'>,
): MetricsEvent => {
  return {
    ...base,
    ...fields,
    '@type': RootEventType.MetricsEvent,
  }
}

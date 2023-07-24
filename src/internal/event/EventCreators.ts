import { BKTException, TimeoutException } from '../../BKTExceptions'
import {
  EvaluationEvent,
  GoalEvent,
  MetricsEvent,
  BaseEvent,
  RootEventType,
} from '../model/Event'
import {
  ApiId,
  LatencyMetricsEvent,
  MetricsEventData,
  MetricsEventType,
  SizeMetricsEvent,
} from '../model/MetricsEventData'
import { SourceID } from '../model/SourceID'
import { SDK_VERSION } from '../version'

export const newMetadata = (
  appVersion: string,
  // osVersion: string,
  deviceModel: string,
): Record<string, string> => {
  return {
    app_version: appVersion,
    // os_version, osVersion is not available in javascript-client-sdk
    device_model: deviceModel,
  }
}

export const newBaseEvent = (
  timestamp: number,
  metadata: Record<string, string>,
): BaseEvent => {
  return {
    timestamp,
    sourceId: SourceID.JAVASCRIPT,
    sdkVersion: SDK_VERSION,
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
  latencySecond: number,
  featureTag: string,
): LatencyMetricsEvent => {
  return {
    apiId,
    labels: { tag: featureTag },
    latencySecond,
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
  error: BKTException,
  featureTag: string,
): MetricsEventData => {
  const data: MetricsEventData = {
    apiId,
    labels: { tag: featureTag },
    '@type': error.type ?? MetricsEventType.UnknownError,
  }

  if (error.type === MetricsEventType.TimeoutError) {
    const timeoutMillis = (error as TimeoutException).timeoutMillis
    data.labels.timeout = (timeoutMillis / 1000).toString()
  }

  return data
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

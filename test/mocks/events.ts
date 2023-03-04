import {
  EvaluationEvent,
  Event,
  EventType,
} from '../../src/internal/model/Event'
import {
  ApiId,
  LatencyMetricsEvent,
  MetricsEventType,
} from '../../src/internal/model/MetricsEventData'
import { SourceID } from '../../src/internal/model/SourceID'
import { user1 } from './users'

export const evaluationEvent1: Event = {
  id: '5ce0ae1a-8568-44d3-961b-89d7735f2a93',
  type: EventType.EVALUATION,
  event: {
    timestamp: 1661780821,
    featureId: 'evaluation1',
    featureVersion: 1,
    userId: user1.id,
    user: user1,
    variationId: 'variation1',
    reason: { type: 'DEFAULT' },
    tag: 'javascript',
    sourceId: SourceID.JAVASCRIPT,
    sdkVersion: '1.0.0',
    metadata: {},
  } satisfies EvaluationEvent,
}

export const evaluationEvent2: Event = {
  id: '62d76a53-3396-4dfb-8dce-dd1b794a984d',
  type: EventType.EVALUATION,
  event: {
    timestamp: 1661780821,
    featureId: 'evaluation2',
    featureVersion: 1,
    userId: user1.id,
    user: user1,
    variationId: 'variation2',
    reason: { type: 'DEFAULT' },
    tag: 'javascript',
    sourceId: SourceID.JAVASCRIPT,
    sdkVersion: '1.0.0',
    metadata: {
      appVersion: '1.2.3',
      osVersion: 'os_version_value',
      deviceModel: 'device_model_value',
    },
  } satisfies EvaluationEvent,
}

export const goalEvent1: Event = {
  id: '408741bd-ae4c-45e9-888d-a85e88817fec',
  type: EventType.GOAL,
  event: {
    timestamp: 1661780821,
    goalId: 'goal1',
    userId: user1.id,
    user: user1,
    value: 0.0,
    tag: 'javascript',
    sourceId: SourceID.JAVASCRIPT,
    sdkVersion: '1.0.0',
    metadata: {
      app_version: '1.2.3',
      os_version: 'os_version_value',
      device_model: 'device_model_value',
    },
  },
}

export const goalEvent2: Event = {
  id: '5ea231b4-c3c7-4b9f-97a2-ee50337f51f0',
  type: EventType.GOAL,
  event: {
    timestamp: 1661780821,
    goalId: 'goal2',
    userId: user1.id,
    user: user1,
    value: 0.0,
    tag: 'javascript',
    sourceId: SourceID.JAVASCRIPT,
    sdkVersion: '1.0.0',
    metadata: {
      app_version: '1.2.3',
      os_version: 'os_version_value',
      device_model: 'device_model_value',
    },
  },
}

export const latencyMetricsEvent1: LatencyMetricsEvent = {
  apiId: ApiId.GET_EVALUATION,
  labels: {
    tag: 'javascript',
  },
  duration: 2000,
  '@type': MetricsEventType.LatencyMetrics,
}

export const metricsEvent1: Event = {
  id: 'e1c03cae-367d-4be4-a613-759441a37801',
  type: EventType.METRICS,
  event: {
    timestamp: 1661823274, // 2022-08-30 01:34:34
    event: latencyMetricsEvent1,
    sdkVersion: '1.0.0',
    metadata: {
      app_version: '1.2.3',
      os_version: 'os_version_value',
      device_model: 'device_model_value',
    },
    sourceId: SourceID.JAVASCRIPT,
  },
}

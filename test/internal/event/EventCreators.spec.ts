import {
  newMetadata,
  newBaseEvent,
  newEvaluationEvent,
  newDefaultEvaluationEvent,
  newGoalEvent,
  newLatencyMetricsData,
  newSizeMetricsData,
  newErrorMetricsData,
  newMetricsEvent,
} from '../../../src/internal/event/EventCreators'
import {
  RootEventType,
} from '../../../src/internal/model/Event'
import { MetricsEventType } from '../../../src/internal/model/MetricsEventData'
import {
  TimeoutException,
  RedirectRequestException,
  UnknownException,
} from '../../../src/BKTExceptions'
import { SourceID } from '../../../src/internal/model/SourceID'
import { describe, it, expect } from 'vitest'
import type { Reason } from '../../../src/internal/model/Reason'

describe('EventCreators', () => {
  it('should create metadata', () => {
    const meta = newMetadata('1.0.0', 'iPhone')
    expect(meta).toEqual({ app_version: '1.0.0', device_model: 'iPhone' })
  })

  it('should create base event', () => {
    const base = newBaseEvent(123, { foo: 'bar' }, SourceID.REACT, '0.0.5')
    expect(base).toEqual({
      timestamp: 123,
      sourceId: SourceID.REACT,
      sdkVersion: '0.0.5',
      metadata: { foo: 'bar' },
    })
  })

  it('should create evaluation event', () => {
    const base = newBaseEvent(1, {}, 1, '1.0.0')
    const fields = {
      featureId: 'f',
      featureVersion: 1,
      variationId: 'v',
      userId: 'u',
      user: { id: 'u' }, // minimal User object
      reason: { type: 'DEFAULT' } as Reason, // explicit Reason type
      tag: 'tag',
    }
    const event = newEvaluationEvent(base, fields)
    expect(event['@type']).toBe(RootEventType.EvaluationEvent)
    expect(event.featureId).toBe('f')
    expect(event.variationId).toBe('v')
  })

  it('should create default evaluation event', () => {
    const base = newBaseEvent(1, {}, SourceID.OPEN_FEATURE_JAVASCRIPT, '1.0.0')
    const fields = {
      featureId: 'f',
      featureVersion: 1,
      variationId: 'v',
      userId: 'u',
      user: { id: 'u' },
      reason: { type: 'DEFAULT' } as Reason,
      tag: 'tag',
    }
    const event = newDefaultEvaluationEvent(base, fields)
    expect(event['@type']).toBe(RootEventType.EvaluationEvent)
    expect(event.sourceId).toBe(SourceID.OPEN_FEATURE_JAVASCRIPT)
    expect(event.sdkVersion).toBe('1.0.0')
  })

  it('should create goal event', () => {
    const base = newBaseEvent(1, {}, SourceID.OPEN_FEATURE_JAVASCRIPT, '1.0.0')
    const fields = {
      goalId: 'g',
      value: 42,
      userId: 'u',
      user: { id: 'u' },
      tag: 'tag',
    }
    const event = newGoalEvent(base, fields)
    expect(event['@type']).toBe(RootEventType.GoalEvent)
    expect(event.goalId).toBe('g')
    expect(event.value).toBe(42)
    expect(event.sourceId).toBe(SourceID.OPEN_FEATURE_JAVASCRIPT)
    expect(event.sdkVersion).toBe('1.0.0')
  })

  it('should create latency metrics data', () => {
    const data = newLatencyMetricsData(1, 0.5, 'tag')
    expect(data).toEqual({
      apiId: 1,
      labels: { tag: 'tag' },
      latencySecond: 0.5,
      '@type': MetricsEventType.LatencyMetrics,
    })
  })

  it('should create size metrics data', () => {
    const data = newSizeMetricsData(1, 100, 'tag')
    expect(data).toEqual({
      apiId: 1,
      labels: { tag: 'tag' },
      sizeByte: 100,
      '@type': MetricsEventType.SizeMetrics,
    })
  })

  it('should create error metrics data for TimeoutException', () => {
    const error = new TimeoutException(1000, 'timeout')
    const data = newErrorMetricsData(1, error, 'tag')
    expect(data.apiId).toBe(1)
    expect(data.labels.tag).toBe('tag')
    expect(data.labels.timeout).toBe('1')
    expect(data['@type']).toBe(MetricsEventType.TimeoutError)
  })

  it('should create error metrics data for RedirectRequestException', () => {
    const error = new RedirectRequestException(302, 'redirect')
    const data = newErrorMetricsData(1, error, 'tag')
    expect(data.labels.response_code).toBe('302')
    expect(data['@type']).toBe(MetricsEventType.RedirectRequestError)
  })

  it('should create error metrics data for UnknownException', () => {
    const error = new UnknownException('unknown', 500)
    const data = newErrorMetricsData(1, error, 'tag')
    expect(data.labels.response_code).toBe('500')
    expect(data.labels.error_message).toBe('unknown')
    expect(data['@type']).toBe(MetricsEventType.UnknownError)
  })

  it('should create metrics event', () => {
    const base = newBaseEvent(1, {}, SourceID.REACT, '0.0.5')
    const latencyMetricsEvent = newLatencyMetricsData(1, 0.5, 'tag')
    const event = newMetricsEvent(base, {
      event: latencyMetricsEvent,
    })
    expect(event['@type']).toBe(RootEventType.MetricsEvent)
    expect(event.event).toEqual(latencyMetricsEvent)
    expect(event.sourceId).toBe(SourceID.REACT)
    expect(event.sdkVersion).toBe('0.0.5')
  })
})

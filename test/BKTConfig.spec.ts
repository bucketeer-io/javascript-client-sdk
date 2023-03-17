import { describe, test, expect } from 'vitest'
import { defineBKTConfig } from '../src/BKTConfig'

const defaultConfig: Parameters<typeof defineBKTConfig>[0] = {
  apiKey: 'api-key',
  apiEndpoint: 'https://example.com',
  featureTag: 'feature-tag',
  appVersion: '1.2.3',
  userAgent: 'user-agent-value',
  fetch,
}

describe('defineBKTConfig', () => {
  test('all parameters are valid', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
    })

    expect(result).toStrictEqual({
      ...defaultConfig,
      eventsFlushInterval: 60_000,
      eventsMaxBatchQueueCount: 50,
      pollingInterval: 600_000,
      storageKeyPrefix: '',
    })
  })

  test('empty apiKey throws', () => {
    expect(() => {
      defineBKTConfig({
        ...defaultConfig,
        apiKey: '',
      })
    }).toThrowError('apiKey is required')
  })

  test('empty apiEndpoint throws', () => {
    expect(() => {
      defineBKTConfig({
        ...defaultConfig,
        apiEndpoint: '',
      })
    }).toThrowError('apiEndpoint is required')
  })

  test('invalid apiEndpoint throws', () => {
    expect(() => {
      defineBKTConfig({
        ...defaultConfig,
        apiEndpoint: 'not a valid url',
      })
    }).toThrowError('apiEndpoint is invalid')
  })

  test('empty featureTag throws', () => {
    expect(() => {
      defineBKTConfig({
        ...defaultConfig,
        featureTag: '',
      })
    }).toThrowError('featureTag is required')
  })

  test('empty appVersion throws', () => {
    expect(() => {
      defineBKTConfig({
        ...defaultConfig,
        appVersion: '',
      })
    }).toThrowError('appVersion is required')
  })

  test('sooner eventFlushInterval should be replaced with default value', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
      eventsFlushInterval: 10,
    })

    expect(result.eventsFlushInterval).toBe(60_000)
  })

  test('sooner pollingInterval should be replaced with default value', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
      pollingInterval: 10,
    })

    expect(result.pollingInterval).toBe(600_000)
  })

  test('empty userAgent should be replaced with a browser value', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
      userAgent: '',
    })

    expect(result.userAgent).toBe(window.navigator.userAgent)
  })
})

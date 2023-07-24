import { suite, test, expect } from 'vitest'
import { defineBKTConfig } from '../src/BKTConfig'
import { IllegalArgumentException } from '../src/BKTExceptions'
import { createBKTStorage } from '../src/BKTStorage'

const defaultConfig: Parameters<typeof defineBKTConfig>[0] = {
  apiKey: 'api-key',
  apiEndpoint: 'https://example.com',
  featureTag: 'feature-tag',
  appVersion: '1.2.3',
  userAgent: 'user-agent-value',
}

suite('defineBKTConfig', () => {
  test('all parameters are valid', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
    })

    expect(result).toStrictEqual({
      ...defaultConfig,
      eventsFlushInterval: 60_000,
      eventsMaxQueueSize: 50,
      pollingInterval: 600_000,
      storageKeyPrefix: '',
      fetch,
      storageFactory: createBKTStorage,
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

  test('empty userAgent should be replaced with default value', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
      userAgent: '',
    })

    if (typeof window === 'undefined') {
      expect(result.userAgent).toBe(
        `Bucketeer JavaScript SDK(${__BKT_SDK_VERSION__})`,
      )
    } else {
      expect(result.userAgent).toBe(window.navigator.userAgent)
    }
  })

  test('explicitly passing undefined to fetch field throws', () => {
    expect(() => {
      defineBKTConfig({
        ...defaultConfig,
        fetch: undefined,
      })
    }).toThrow(IllegalArgumentException)
  })

  test('explicitly passing undefined to featureTag results in empty string', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
      featureTag: undefined,
    })

    expect(result.featureTag).toBe('')
  })
})

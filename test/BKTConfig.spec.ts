import { suite, test, expect } from 'vitest'
import { defineBKTConfig, type RawBKTConfig } from '../src/BKTConfig'
import { IllegalArgumentException } from '../src/BKTExceptions'
import { createBKTStorage } from '../src/BKTStorage'
import { SDK_VERSION } from '../src/internal/version'
import { SourceId } from '../src/internal/model/SourceId'
import type { InternalConfig } from '../src/internal/InternalConfig'

const defaultConfig: RawBKTConfig = {
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
      eventsFlushInterval: 10_000,
      eventsMaxQueueSize: 50,
      pollingInterval: 600_000,
      storageKeyPrefix: '',
      fetch,
      storageFactory: createBKTStorage,
      enableAutoPageLifecycleFlush: true,
      sdkVersion: SDK_VERSION,
      sourceId: SourceId.JAVASCRIPT,
    })
  })

  test('all parameters are valid - with wrapperSDK SourceId & Version', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
      wrapperSdkSourceId: SourceId.REACT,
      wrapperSdkVersion: '1.2.5',
    })

    expect(result).toStrictEqual({
      ...defaultConfig,
      eventsFlushInterval: 10_000,
      eventsMaxQueueSize: 50,
      pollingInterval: 600_000,
      storageKeyPrefix: '',
      fetch,
      storageFactory: createBKTStorage,
      enableAutoPageLifecycleFlush: true,
      wrapperSdkSourceId: SourceId.REACT,
      wrapperSdkVersion: '1.2.5',
      sdkVersion: '1.2.5',
      sourceId: SourceId.REACT,
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
      eventsFlushInterval: 5_000,
    })

    expect(result.eventsFlushInterval).toBe(10_000)
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

  test('explicitly passing undefined to fetch field will not throw', () => {
    // fetch is optional, so passing undefined should not throw
    // the global fetch will be used
    expect(() => {
      defineBKTConfig({
        ...defaultConfig,
        fetch: undefined,
      })
    }).not.toThrow(IllegalArgumentException)
  })

  test('explicitly passing undefined to featureTag results in empty string', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
      featureTag: undefined,
    })

    expect(result.featureTag).toBe('')
  })

  test('should use default values when config properties are undefined', () => {
    // Test case 1: eventsMaxQueueSize should default to 50 when undefined
    const configWithUndefinedMaxQueue: RawBKTConfig = {
      ...defaultConfig,
      eventsMaxQueueSize: undefined,
    }

    const result1 = defineBKTConfig(configWithUndefinedMaxQueue)
    expect(result1.eventsMaxQueueSize).toBe(50)

    // Test case 2: storageKeyPrefix should default to '' when undefined
    const configWithUndefinedStoragePrefix: RawBKTConfig = {
      ...defaultConfig,
      storageKeyPrefix: undefined,
    }

    const result2 = defineBKTConfig(configWithUndefinedStoragePrefix)
    expect(result2.storageKeyPrefix).toBe('')

    // Test case 3: pollingInterval should default to 600_000 when undefined
    const configWithUndefinedPolling: RawBKTConfig = {
      ...defaultConfig,
      pollingInterval: undefined,
    }

    const result3 = defineBKTConfig(configWithUndefinedPolling)
    expect(result3.pollingInterval).toBe(600_000)

    // Test case 4: eventsFlushInterval should default to 10_000 when undefined
    const configWithUndefinedFlush: RawBKTConfig = {
      ...defaultConfig,
      eventsFlushInterval: undefined,
    }

    const result4 = defineBKTConfig(configWithUndefinedFlush)
    expect(result4.eventsFlushInterval).toBe(10_000)

    // Test case 5: storageFactory should default to createBKTStorage when undefined
    const configWithUndefinedStorageFactory: RawBKTConfig = {
      ...defaultConfig,
      storageFactory: undefined,
    }

    const result5 = defineBKTConfig(configWithUndefinedStorageFactory)
    expect(result5.storageFactory).toBe(createBKTStorage)

    // Test case 6: enableAutoPageLifecycleFlush should default to true when undefined
    const configWithUndefinedAutoFlush: RawBKTConfig = {
      ...defaultConfig,
      enableAutoPageLifecycleFlush: undefined,
    }

    const result6 = defineBKTConfig(configWithUndefinedAutoFlush)
    expect(result6.enableAutoPageLifecycleFlush).toBe(true)
  })

  test('enableAutoPageLifecycleFlush can be explicitly disabled', () => {
    const result = defineBKTConfig({
      ...defaultConfig,
      enableAutoPageLifecycleFlush: false,
    })

    expect(result.enableAutoPageLifecycleFlush).toBe(false)
  })

  test('invalid apiEndpoint throws', () => {
    expect(() => {
      defineBKTConfig({
        ...defaultConfig,
        apiEndpoint: 'not a valid url',
      })
    }).toThrowError('apiEndpoint is invalid')
  })

  suite('sourceId and sdkVersion resolution', () => {
    test('default sourceId and sdkVersion without wrapper config', () => {
      const result = defineBKTConfig({
        ...defaultConfig,
      })
      const internalResult = result as InternalConfig

      expect(internalResult.sourceId).toBe(SourceId.JAVASCRIPT)
      expect(internalResult.sdkVersion).toBe(SDK_VERSION)
    })

    test('supported wrapper SDKs with valid sourceId and version', () => {
      const testCases = [
        { sourceId: SourceId.REACT, version: '1.0.0' },
        { sourceId: SourceId.REACT_NATIVE, version: '2.1.0' },
        { sourceId: SourceId.OPEN_FEATURE_JAVASCRIPT, version: '3.2.1' },
        { sourceId: SourceId.OPEN_FEATURE_REACT, version: '4.0.0' },
        { sourceId: SourceId.OPEN_FEATURE_REACT_NATIVE, version: '5.5.5' },
      ]

      testCases.forEach(({ sourceId, version }) => {
        const result = defineBKTConfig({
          ...defaultConfig,
          wrapperSdkSourceId: sourceId,
          wrapperSdkVersion: version,
        })
        const internalResult = result as InternalConfig

        expect(internalResult.sourceId).toBe(sourceId)
        expect(internalResult.sdkVersion).toBe(version)
      })
    })

    test('unsupported wrapper SDK sourceIds throw error', () => {
      const unsupportedSourceIds = [SourceId.ANDROID, SourceId.UNKNOWN]

      unsupportedSourceIds.forEach((sourceId) => {
        expect(() => {
          defineBKTConfig({
            ...defaultConfig,
            wrapperSdkSourceId: sourceId,
            wrapperSdkVersion: '1.0.0',
          })
        }).toThrowError(/Unsupported wrapperSdkSourceId/)
      })
    })

    test('wrapper SDK with missing or empty version throws error', () => {
      const invalidVersionCases = [{ version: undefined }, { version: '' }]

      invalidVersionCases.forEach(({ version }) => {
        expect(() => {
          defineBKTConfig({
            ...defaultConfig,
            wrapperSdkSourceId: SourceId.REACT,
            wrapperSdkVersion: version,
          })
        }).toThrowError('Config is missing wrapperSdkVersion')
      })
    })

    test('explicitly setting wrapperSdkSourceId to undefined uses default', () => {
      const result = defineBKTConfig({
        ...defaultConfig,
        wrapperSdkSourceId: undefined,
      })
      const internalResult = result as InternalConfig

      expect(internalResult.sourceId).toBe(SourceId.JAVASCRIPT)
      expect(internalResult.sdkVersion).toBe(SDK_VERSION)
    })
  })
})

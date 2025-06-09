import { describe, it, expect } from 'vitest'

import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { requiredInternalConfig, resolveSDKVersion, resolveSourceId, supportedWrapperSdkSourceIds } from '../src/internal/InternalConfig'
import { SourceId } from '../src/internal/model/SourceId'
import { SDK_VERSION } from '../src/internal/version'
import { BKTStorage } from '../src/BKTStorage'
import { FetchRequestLike, FetchResponseLike } from '../src/internal/remote/fetch'

const inputConfig = {
  apiKey: 'api-key',
  apiEndpoint: 'https://example.com',
  featureTag: 'feature-tag',
  appVersion: '1.2.3',
  userAgent: 'user-agent-value',
  eventsFlushInterval: 0,
  eventsMaxQueueSize: 0,
  pollingInterval: 0,
  fetch: function (_url: string, _request: FetchRequestLike): Promise<FetchResponseLike> {
    throw new Error('Just a stub for testing')
  },
  storageFactory: function <T>(_key: string): BKTStorage<T> {
    throw new Error('Just a stub for testing')
  }
} satisfies BKTConfig

describe('InternalConfig', () => {
  describe('requiredInternalConfig', () => {
    it('should return the config when it has already been processed by defineBKTConfig', () => {
      const config = inputConfig
      const internalConfig = defineBKTConfig(config)
      const result = requiredInternalConfig(internalConfig)

      expect(result).toEqual(internalConfig)
      expect(result.sourceId).toBe(SourceId.JAVASCRIPT)
      expect(result.sdkVersion).toBe(SDK_VERSION)
    })

    it('should throw error when BKTConfig is not be processed by defineBKTConfig', () => {
      const config = inputConfig // BKTConfig without sourceId

      expect(() => {
        requiredInternalConfig(config)
      }).toThrowError('Config is missing sourceId. Must be processed by defineBKTConfig first.')
    })

    it('should throw error when config is missing sdkVersion', () => {
      const configWithSourceId = {
        ...inputConfig,
        wrapperSdkSourceId: SourceId.REACT,
        sourceId: SourceId.REACT
      }// Force the type to bypass TypeScript checking

      expect(() => {
        requiredInternalConfig(configWithSourceId)
      }).toThrowError('Config is missing sdkVersion. Must be processed by defineBKTConfig first.')
    })

    it('should work with wrapper SDK configs', () => {
      const config = {
        ...inputConfig,
        wrapperSdkSourceId: SourceId.REACT,
        wrapperSdkVersion: '2.0.1'
      } satisfies BKTConfig
      const internalConfig = defineBKTConfig(config)

      const result = requiredInternalConfig(internalConfig)

      expect(result).toEqual(internalConfig)
      expect(result.sourceId).toBe(SourceId.REACT)
      expect(result.sdkVersion).toBe('2.0.1')
    })
  })

  describe('resolveSourceId', () => {
    it('should return JAVASCRIPT if no wrapperSdkSourceId is provided', () => {
      const config = { ...inputConfig }
      expect(resolveSourceId(config)).toBe(SourceId.JAVASCRIPT)
    })

    it('should return correct SourceId for all supported wrapperSdkSourceIds', () => {
      const supportedSourceIds = supportedWrapperSdkSourceIds

      supportedSourceIds.forEach(sourceId => {
        const config = { ...inputConfig, wrapperSdkSourceId: sourceId }
        expect(resolveSourceId(config)).toBe(sourceId)
      })
    })

    it('should throw error for unsupported wrapperSdkSourceIds', () => {
      const allRelatedJavaScriptSourceIds: number[] = [
        SourceId.JAVASCRIPT,
        ...supportedWrapperSdkSourceIds
      ]
      const unsupportedSourceIds = Object.values(SourceId).filter(
        sourceId => !allRelatedJavaScriptSourceIds.includes(sourceId)
      )

      unsupportedSourceIds.forEach(sourceId => {
        const config = { ...inputConfig, wrapperSdkSourceId: sourceId } satisfies BKTConfig
        expect(() => resolveSourceId(config)).toThrowError(`Unsupported wrapperSdkSourceId: ${sourceId}`)
      })
    })
  })

  describe('resolveSDKVersion', () => {
    it('should return SDK_VERSION for JAVASCRIPT sourceId', () => {
      const config = { ...inputConfig }
      expect(resolveSDKVersion(config, SourceId.JAVASCRIPT)).toBe(SDK_VERSION)
    })

    it('should return wrapperSdkVersion when sourceID != JAVASCRIPT', () => {
      nonJavaScriptSourceIds.forEach(sourceId => {
        const config = { ...inputConfig, wrapperSdkVersion: '3.1.4' }
        expect(resolveSDKVersion(config, sourceId)).toBe('3.1.4')
      })
    })

    it('should throw error if wrapperSdkVersion is missing when sourceID != JAVASCRIPT', () => {
      nonJavaScriptSourceIds.forEach(sourceId => {
        const config = { ...inputConfig }
        expect(() => resolveSDKVersion(config, sourceId)).toThrowError('Config is missing wrapperSdkVersion')
      })
    })
  })
})

const nonJavaScriptSourceIds = Object.values(SourceId).filter(
  sourceId => sourceId !== SourceId.JAVASCRIPT
)

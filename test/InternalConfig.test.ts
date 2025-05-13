import { describe, it, expect, vi, beforeEach } from 'vitest'

import * as versionModule from '../src/internal/version'
import { defineBKTConfig } from '../src/BKTConfig'
import { createInternalConfig, DEFAULT_WRAPPER_SDK_VERSION } from '../src/internal/InternalConfig'
import { SourceID } from '../src/internal/model/SourceID'

// Mock the SDK_VERSION
vi.mock('./version', () => ({
  SDK_VERSION: '1.2.3'
}))

const defaultConfig: Parameters<typeof defineBKTConfig>[0] = {
  apiKey: 'api-key',
  apiEndpoint: 'https://example.com',
  featureTag: 'feature-tag',
  appVersion: '1.2.3',
  userAgent: 'user-agent-value',
}

describe('InternalConfig', () => {
  describe('createInternalConfig', () => {
    beforeEach(() => {
      // Clear any console mocks between tests
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('should create internal config with default sourceId and version when no wrapper is specified', () => {
      const config = defineBKTConfig(defaultConfig)
      
      const internalConfig = createInternalConfig(config)
      
      expect(internalConfig).toEqual({
        ...config,
        sourceId: SourceID.JAVASCRIPT,
        sdkVersion: versionModule.SDK_VERSION
      })
    })
    
    it('should use the wrapper sourceId when a supported one is provided', () => {
      const config = defineBKTConfig({
        ...defaultConfig,
        wrapperSdkSourceId: SourceID.REACT 
      })
      
      const internalConfig = createInternalConfig(config)
      
      expect(internalConfig.sourceId).toBe(SourceID.REACT)
    })
    
    it('should default to JAVASCRIPT sourceId when an unsupported wrapper sourceId is provided', () => {
      const unsupportedSourceId = 999
      const config = defineBKTConfig({
        ...defaultConfig,
        wrapperSdkSourceId: unsupportedSourceId
      })
      
      const internalConfig = createInternalConfig(config)
      
      expect(internalConfig.sourceId).toBe(SourceID.JAVASCRIPT)
      expect(console.warn).toHaveBeenCalled()
    })
    
    it('should use the wrapper SDK version when a wrapper sourceId is used', () => {
      const config = defineBKTConfig({
        ...defaultConfig,
        wrapperSdkSourceId: SourceID.REACT,
        wrapperSdkVersion: '2.0.0'
      })
      
      const internalConfig = createInternalConfig(config)

      expect(internalConfig).toEqual({
        ...config,
        sourceId: SourceID.REACT,
        sdkVersion: '2.0.0'
      })
    })
    
    it('should use default wrapper SDK version when a wrapper sourceId is used without version', () => {
      const config = defineBKTConfig({
        ...defaultConfig,
        wrapperSdkSourceId: SourceID.REACT
      })
      
      const internalConfig = createInternalConfig(config)

      expect(internalConfig.sourceId).toBe(SourceID.REACT)
      expect(internalConfig.sdkVersion).toBe(DEFAULT_WRAPPER_SDK_VERSION)
    })
    
    it('should preserve all original config properties', () => {
      const config = defineBKTConfig(defaultConfig)
      
      const internalConfig = createInternalConfig(config)
      
      expect(internalConfig).toMatchObject(config)
      expect(internalConfig.sourceId).toBe(SourceID.JAVASCRIPT)
      expect(internalConfig.sdkVersion).toBe(versionModule.SDK_VERSION)
    })
  })
})

import { describe, it, expect } from 'vitest'
import { defineBKTConfig } from '../src/main.native'
import { defineBKTConfig as baseDefineBKTConfig } from '../src/BKTConfig'
import { IdGenerator } from '../src/internal/IdGenerator'
import { IllegalArgumentException } from '../src/BKTExceptions'

describe('defineBKTConfig - React (Native) required idGenerator', () => {
  const validRawConfig = {
    apiKey: 'api-key',
    apiEndpoint: 'https://api.bucketeer.io',
    featureTag: 'tag',
    appVersion: '1.0.0',
  }

  it('should validate idGenerator and return processed config', () => {
    const mockIdGenerator: IdGenerator = {
      newId: () => 'test-id',
    }
    const config = {
      ...validRawConfig,
      idGenerator: mockIdGenerator,
    }

    const result = defineBKTConfig(config)

    // Should be fully processed BKTConfig with all required properties
    expect(result).toBeDefined()
    expect(result.idGenerator).toBe(mockIdGenerator)
    expect(result.apiKey).toBe(config.apiKey)
    expect(result.apiEndpoint).toBe(config.apiEndpoint)
    expect(result.fetch).toBeDefined()
    expect(result.storageFactory).toBeDefined()
  })

  it('should throw error when idGenerator is missing', () => {
    const config = { ...validRawConfig }
    // idGenerator is missing

    expect(() => {
      defineBKTConfig(config)
    }).toThrowError(
      new IllegalArgumentException(
        'idGenerator is required in the React Native environment',
      ),
    )
  })

  it('should throw error when idGenerator is undefined', () => {
    const config = {
      ...validRawConfig,
      idGenerator: undefined,
    }

    expect(() => {
      defineBKTConfig(config)
    }).toThrowError(
      new IllegalArgumentException(
        'idGenerator is required in the React Native environment',
      ),
    )
  })

  it('should throw error when idGenerator is null', () => {
    const config = {
      ...validRawConfig,
      idGenerator: null as unknown as IdGenerator,
    }

    expect(() => {
      defineBKTConfig(config)
    }).toThrowError(
      new IllegalArgumentException(
        'idGenerator is required in the React Native environment',
      ),
    )
  })

  it('should not change the result from original baseDefineBKTConfig except for validation', () => {
    const mockIdGenerator: IdGenerator = {
      newId: () => 'test-id',
    }
    const config = {
      ...validRawConfig,
      idGenerator: mockIdGenerator,
    }

    const result = defineBKTConfig(config)
    const originalResult = baseDefineBKTConfig(config)

    // Should have the same properties as the original
    expect(result.apiKey).toBe(originalResult.apiKey)
    expect(result.apiEndpoint).toBe(originalResult.apiEndpoint)
    expect(result.featureTag).toBe(originalResult.featureTag)
    expect(result.fetch).toBe(originalResult.fetch)
    expect(result.storageFactory).toBe(originalResult.storageFactory)
    expect(result.idGenerator).toBe(originalResult.idGenerator)
  })
})

import { describe, it, expect } from 'vitest'
import { requiredIdGenerator } from '../src/main.native'
import { defineBKTConfig } from '../src/BKTConfig'
import { IdGenerator } from '../src/internal/IdGenerator'

describe('requiredIdGenerator', () => {
  it('should return idGenerator if provided', () => {
    const mockIdGenerator: IdGenerator = {
      newId: () => 'test-id',
    }
    const config = defineBKTConfig({
      apiKey: 'api-key',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'tag',
      appVersion: '1.0.0',
      idGenerator: mockIdGenerator,
    })
    // Check the return value instead of just not throwing
    expect(requiredIdGenerator(config)).toBe(mockIdGenerator)
  })

  it('should throw error if idGenerator is not provided', () => {
    const config = defineBKTConfig({
      apiKey: 'api-key',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'tag',
      appVersion: '1.0.0',
      // idGenerator is intentionally omitted
    })
    expect(() => requiredIdGenerator(config)).toThrow(
      'idGenerator is required in this environment',
    )
  })

  it('should throw error if idGenerator is undefined', () => {
    const config = defineBKTConfig({
      apiKey: 'api-key',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'tag',
      appVersion: '1.0.0',
      idGenerator: undefined,
    })
    expect(() => requiredIdGenerator(config)).toThrow(
      'idGenerator is required in this environment',
    )
  })

  it('should throw error if idGenerator is null', () => {
    const config = defineBKTConfig({
      apiKey: 'api-key',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'tag',
      appVersion: '1.0.0',
      idGenerator: null as unknown as IdGenerator, // Cast to satisfy type checking initially
    })
    expect(() => requiredIdGenerator(config)).toThrow(
      'idGenerator is required in this environment',
    )
  })
})



import { describe, it, expect } from 'vitest'
import { SourceId, sourceIdFromNumber } from '../../../src/internal/model/SourceId'

describe('sourceIdFromNumber', () => {
  it('returns the correct SourceId for valid inputs', () => {
    expect(sourceIdFromNumber(0)).toBe(SourceId.UNKNOWN)
    expect(sourceIdFromNumber(1)).toBe(SourceId.ANDROID)
    expect(sourceIdFromNumber(2)).toBe(SourceId.IOS)
    expect(sourceIdFromNumber(4)).toBe(SourceId.GOAL_BATCH)
    expect(sourceIdFromNumber(5)).toBe(SourceId.GO_SERVER)
    expect(sourceIdFromNumber(6)).toBe(SourceId.NODE_SERVER)
    expect(sourceIdFromNumber(7)).toBe(SourceId.JAVASCRIPT)
    expect(sourceIdFromNumber(8)).toBe(SourceId.FLUTTER)
    expect(sourceIdFromNumber(9)).toBe(SourceId.REACT)
    expect(sourceIdFromNumber(10)).toBe(SourceId.REACT_NATIVE)
    expect(sourceIdFromNumber(100)).toBe(SourceId.OPEN_FEATURE_KOTLIN)
    expect(sourceIdFromNumber(101)).toBe(SourceId.OPEN_FEATURE_SWIFT)
    expect(sourceIdFromNumber(102)).toBe(SourceId.OPEN_FEATURE_JAVASCRIPT)
    expect(sourceIdFromNumber(103)).toBe(SourceId.OPEN_FEATURE_GO)
    expect(sourceIdFromNumber(104)).toBe(SourceId.OPEN_FEATURE_NODE)
  })

  it('returns SourceId.UNKNOWN for unrecognized source IDs', () => {
    expect(sourceIdFromNumber(33333)).toBe(SourceId.UNKNOWN) // WEB is deprecated
    expect(sourceIdFromNumber(11)).toBe(SourceId.UNKNOWN)
    expect(sourceIdFromNumber(99)).toBe(SourceId.UNKNOWN)
    expect(sourceIdFromNumber(1000)).toBe(SourceId.UNKNOWN)
  })

  it('returns SourceId.UNKNOWN for negative numbers and other edge cases', () => {
    expect(sourceIdFromNumber(-1)).toBe(SourceId.UNKNOWN)
    expect(sourceIdFromNumber(Number.MAX_SAFE_INTEGER)).toBe(SourceId.UNKNOWN)
  })
})

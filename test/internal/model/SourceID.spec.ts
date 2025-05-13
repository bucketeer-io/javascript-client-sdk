import { describe, it, expect } from 'vitest'
import { SourceID, sourceIdFromNumber } from '../../../src/internal/model/SourceID'

describe('sourceIdFromNumber', () => {
  it('returns the correct SourceID for valid inputs', () => {
    expect(sourceIdFromNumber(0)).toBe(SourceID.UNKNOWN)
    expect(sourceIdFromNumber(1)).toBe(SourceID.ANDROID)
    expect(sourceIdFromNumber(2)).toBe(SourceID.IOS)
    expect(sourceIdFromNumber(4)).toBe(SourceID.GOAL_BATCH)
    expect(sourceIdFromNumber(5)).toBe(SourceID.GO_SERVER)
    expect(sourceIdFromNumber(6)).toBe(SourceID.NODE_SERVER)
    expect(sourceIdFromNumber(7)).toBe(SourceID.JAVASCRIPT)
    expect(sourceIdFromNumber(8)).toBe(SourceID.FLUTTER)
    expect(sourceIdFromNumber(9)).toBe(SourceID.REACT)
    expect(sourceIdFromNumber(10)).toBe(SourceID.REACT_NATIVE)
    expect(sourceIdFromNumber(100)).toBe(SourceID.OPEN_FEATURE_KOTLIN)
    expect(sourceIdFromNumber(101)).toBe(SourceID.OPEN_FEATURE_SWIFT)
    expect(sourceIdFromNumber(102)).toBe(SourceID.OPEN_FEATURE_JAVASCRIPT)
    expect(sourceIdFromNumber(103)).toBe(SourceID.OPEN_FEATURE_GO)
    expect(sourceIdFromNumber(104)).toBe(SourceID.OPEN_FEATURE_NODEJS)
  })

  it('returns SourceID.UNKNOWN for unrecognized source IDs', () => {
    expect(sourceIdFromNumber(33333)).toBe(SourceID.UNKNOWN) // WEB is deprecated
    expect(sourceIdFromNumber(11)).toBe(SourceID.UNKNOWN)
    expect(sourceIdFromNumber(99)).toBe(SourceID.UNKNOWN)
    expect(sourceIdFromNumber(1000)).toBe(SourceID.UNKNOWN)
  })

  it('returns SourceID.UNKNOWN for negative numbers and other edge cases', () => {
    expect(sourceIdFromNumber(-1)).toBe(SourceID.UNKNOWN)
    expect(sourceIdFromNumber(Number.MAX_SAFE_INTEGER)).toBe(SourceID.UNKNOWN)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserIdGenerator } from '../../src/internal/IdGenerator.browser'
import { UUID_V4_REGEX } from '../../src/utils/regex'

const VALID_UUID_V4 = '123e4567-e89b-42d3-a456-426614174000'
const VALID_UUID_V3 = 'ed92afad-81f1-394b-be77-347c7e170fa9'

describe('BrowserIdGenerator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('UUID_V4_REGEX', () => {
    it('matches valid UUID v4', () => {
      expect(VALID_UUID_V4).toMatch(UUID_V4_REGEX)
    })

    it('does not match valid UUID v3 (wrong version digit)', () => {
      expect(VALID_UUID_V3).not.toMatch(UUID_V4_REGEX)
    })

    it('does not match invalid UUID strings', () => {
      expect('not-a-uuid').not.toMatch(UUID_V4_REGEX)
      expect('123e4567-e89b-12d3-a456-426614174000').not.toMatch(UUID_V4_REGEX) // v1
    })

    it('matches actual output from crypto.randomUUID()', () => {
      expect(globalThis.crypto.randomUUID()).toMatch(UUID_V4_REGEX)
    })
  })

  it('uses native randomUUID when it returns a valid uuid v4', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(VALID_UUID_V4)
    const gen = new BrowserIdGenerator()

    const getRandomValuesSpy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const result = gen.newId()

    expect(result).toBe(VALID_UUID_V4)
    expect(getRandomValuesSpy).not.toHaveBeenCalled()
  })

  it('falls back to getRandomValues when randomUUID returns an invalid uuid v4', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(VALID_UUID_V3)
    const gen = new BrowserIdGenerator()

    const getRandomValuesSpy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const result = gen.newId()

    expect(result).not.toBe(VALID_UUID_V3)
    expect(result).toMatch(UUID_V4_REGEX)
    expect(getRandomValuesSpy).toHaveBeenCalledOnce()
  })

  it('falls back to getRandomValues when randomUUID returns undefined', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      undefined as unknown as ReturnType<typeof globalThis.crypto.randomUUID>,
    )
    const gen = new BrowserIdGenerator()

    const getRandomValuesSpy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const result = gen.newId()

    expect(result).toMatch(UUID_V4_REGEX)
    expect(getRandomValuesSpy).toHaveBeenCalledOnce()
  })

  it('falls back to getRandomValues when randomUUID is not a function', () => {
    const originalRandomUUID = globalThis.crypto.randomUUID
    // @ts-expect-error - testing invalid environment
    globalThis.crypto.randomUUID = undefined

    try {
      const gen = new BrowserIdGenerator()
      const getRandomValuesSpy = vi.spyOn(globalThis.crypto, 'getRandomValues')
      const result = gen.newId()
      expect(result).toMatch(UUID_V4_REGEX)
      expect(getRandomValuesSpy).toHaveBeenCalledOnce()
    } finally {
      globalThis.crypto.randomUUID = originalRandomUUID
    }
  })

  it('does not re-check randomUUID validity on subsequent newId() calls', () => {
    const randomUUIDSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue(VALID_UUID_V4)
    const gen = new BrowserIdGenerator()

    gen.newId()
    gen.newId()
    gen.newId()

    // 1 call during construction + 3 calls from newId()
    expect(randomUUIDSpy).toHaveBeenCalledTimes(4)
  })

  it('always uses getRandomValues fallback on every newId() call when randomUUID is unavailable', () => {
    const originalRandomUUID = globalThis.crypto.randomUUID
    // @ts-expect-error - testing invalid environment
    globalThis.crypto.randomUUID = undefined

    try {
      const gen = new BrowserIdGenerator()

      const getRandomValuesSpy = vi.spyOn(globalThis.crypto, 'getRandomValues')

      const results = [gen.newId(), gen.newId(), gen.newId()]

      results.forEach((r) => expect(r).toMatch(UUID_V4_REGEX))
      expect(getRandomValuesSpy).toHaveBeenCalledTimes(3)
    } finally {
      globalThis.crypto.randomUUID = originalRandomUUID
    }
  })

  it('falls back to Math.random when getRandomValues throws', () => {
    // Make randomUUID throw so the constructor sets useNativeRandomUUID = false.
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('randomUUID unavailable')
    })
    const gen = new BrowserIdGenerator()

    // Mock getRandomValues after construction so the constructor is unaffected.
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('getRandomValues unavailable')
    })

    // Make Math.random deterministic so we can prove it was called, not just
    // infer it from the UUID format.
    const mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const result = gen.newId()

    expect(result).toMatch(UUID_V4_REGEX)
    expect(mathRandomSpy).toHaveBeenCalled()
  })

  it('always uses Math.random fallback on every newId() call when both crypto APIs are unavailable', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('randomUUID unavailable')
    })
    const gen = new BrowserIdGenerator()

    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('getRandomValues unavailable')
    })

    const mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const results = [gen.newId(), gen.newId(), gen.newId()]

    results.forEach((r) => expect(r).toMatch(UUID_V4_REGEX))
    // 16 bytes per call × 3 calls
    expect(mathRandomSpy).toHaveBeenCalledTimes(48)
  })
})


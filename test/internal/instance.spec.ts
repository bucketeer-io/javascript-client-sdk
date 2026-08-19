import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setPageLifecycleCleanup,
  getPageLifecycleCleanup,
  clearPageLifecycleCleanup,
} from '../../src/internal/instance'

describe('instance - page lifecycle cleanup', () => {
  beforeEach(() => {
    // Clean up any existing cleanup function before each test
    const existing = getPageLifecycleCleanup()
    if (existing) {
      clearPageLifecycleCleanup()
    }
  })

  it('should store and retrieve cleanup function', () => {
    const mockCleanup = vi.fn()

    setPageLifecycleCleanup(mockCleanup)

    expect(getPageLifecycleCleanup()).toBe(mockCleanup)
  })

  it('should call cleanup function when clearPageLifecycleCleanup is called', () => {
    const mockCleanup = vi.fn()

    setPageLifecycleCleanup(mockCleanup)
    clearPageLifecycleCleanup()

    expect(mockCleanup).toHaveBeenCalledTimes(1)
    expect(getPageLifecycleCleanup()).toBeNull()
  })

  it('should not throw if cleanup function is not set', () => {
    expect(() => clearPageLifecycleCleanup()).not.toThrow()
  })

  it('should prevent memory leaks on multiple set/clear cycles', () => {
    // First cycle
    const mockCleanup1 = vi.fn()
    setPageLifecycleCleanup(mockCleanup1)

    clearPageLifecycleCleanup()
    expect(mockCleanup1).toHaveBeenCalledTimes(1)
    expect(getPageLifecycleCleanup()).toBeNull()

    // Second cycle
    const mockCleanup2 = vi.fn()
    setPageLifecycleCleanup(mockCleanup2)

    expect(getPageLifecycleCleanup()).toBe(mockCleanup2)

    clearPageLifecycleCleanup()
    expect(mockCleanup2).toHaveBeenCalledTimes(1)

    // Verify first cleanup wasn't called again
    expect(mockCleanup1).toHaveBeenCalledTimes(1)
  })

  it('should invoke the previous cleanup before it gets overwritten by a new one', () => {
    const mockCleanup1 = vi.fn()
    const mockCleanup2 = vi.fn()

    setPageLifecycleCleanup(mockCleanup1)
    setPageLifecycleCleanup(mockCleanup2)

    // Setting a new cleanup while one is already stored should invoke the
    // old one immediately, since overwriting it silently would orphan its
    // listeners with no remaining reference to remove them.
    expect(mockCleanup1).toHaveBeenCalledTimes(1)
    expect(mockCleanup2).not.toHaveBeenCalled()
    expect(getPageLifecycleCleanup()).toBe(mockCleanup2)

    clearPageLifecycleCleanup()

    expect(mockCleanup2).toHaveBeenCalledTimes(1)
    // The old cleanup should not be invoked a second time.
    expect(mockCleanup1).toHaveBeenCalledTimes(1)
  })
})

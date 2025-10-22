import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setupPageLifecycleListeners } from '../../src/utils/pageLifecycle'

describe('pageLifecycle', () => {
  describe('setupPageLifecycleListeners', () => {
    let mockWindow: typeof window
    let mockDocument: typeof document
    let addEventListenerSpy: ReturnType<typeof vi.spyOn>
    let removeEventListenerSpy: ReturnType<typeof vi.spyOn>
    let documentAddEventListenerSpy: ReturnType<typeof vi.spyOn>
    let documentRemoveEventListenerSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      // Create mock window and document
      mockWindow = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any

      mockDocument = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        visibilityState: 'visible',
      } as any

      // Replace global window and document
      global.window = mockWindow
      global.document = mockDocument

      addEventListenerSpy = vi.spyOn(mockWindow, 'addEventListener')
      removeEventListenerSpy = vi.spyOn(mockWindow, 'removeEventListener')
      documentAddEventListenerSpy = vi.spyOn(mockDocument, 'addEventListener')
      documentRemoveEventListenerSpy = vi.spyOn(
        mockDocument,
        'removeEventListener',
      )
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should register page lifecycle event listeners', () => {
      const onFlush = vi.fn()

      setupPageLifecycleListeners({ onFlush })

      // Verify pagehide listener was added
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'pagehide',
        expect.any(Function),
      )

      // Verify beforeunload listener was added
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function),
      )

      // Verify visibilitychange listener was added to document
      expect(documentAddEventListenerSpy).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function),
      )
    })

    it('should call onFlush when pagehide event is triggered', () => {
      const onFlush = vi.fn()

      setupPageLifecycleListeners({ onFlush })

      // Get the pagehide handler
      const pagehideHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'pagehide',
      )?.[1] as Function

      expect(pagehideHandler).toBeDefined()

      // Trigger pagehide
      pagehideHandler()

      expect(onFlush).toHaveBeenCalledTimes(1)
    })

    it('should call onFlush when visibilitychange event is triggered and page is hidden', () => {
      const onFlush = vi.fn()

      setupPageLifecycleListeners({ onFlush })

      // Get the visibilitychange handler
      const visibilityChangeHandler =
        documentAddEventListenerSpy.mock.calls.find(
          (call) => call[0] === 'visibilitychange',
        )?.[1] as Function

      expect(visibilityChangeHandler).toBeDefined()

      // Set document to hidden
      mockDocument.visibilityState = 'hidden'

      // Trigger visibilitychange
      visibilityChangeHandler()

      expect(onFlush).toHaveBeenCalledTimes(1)
    })

    it('should NOT call onFlush when visibilitychange event is triggered but page is visible', () => {
      const onFlush = vi.fn()

      setupPageLifecycleListeners({ onFlush })

      // Get the visibilitychange handler
      const visibilityChangeHandler =
        documentAddEventListenerSpy.mock.calls.find(
          (call) => call[0] === 'visibilitychange',
        )?.[1] as Function

      expect(visibilityChangeHandler).toBeDefined()

      // Document is already visible (default state)
      expect(mockDocument.visibilityState).toBe('visible')

      // Trigger visibilitychange
      visibilityChangeHandler()

      expect(onFlush).not.toHaveBeenCalled()
    })

    it('should not call onFlush multiple times for duplicate events', () => {
      const onFlush = vi.fn()

      setupPageLifecycleListeners({ onFlush })

      // Get handlers
      const pagehideHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'pagehide',
      )?.[1] as Function

      const beforeunloadHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'beforeunload',
      )?.[1] as Function

      const visibilityChangeHandler =
        documentAddEventListenerSpy.mock.calls.find(
          (call) => call[0] === 'visibilitychange',
        )?.[1] as Function

      // Trigger multiple events in sequence
      mockDocument.visibilityState = 'hidden'
      visibilityChangeHandler()
      pagehideHandler()
      beforeunloadHandler()

      // onFlush should only be called once due to hasFlushed flag
      expect(onFlush).toHaveBeenCalledTimes(1)
    })

    it('should reset hasFlushed flag when page becomes visible again', () => {
      const onFlush = vi.fn()

      setupPageLifecycleListeners({ onFlush })

      // Get handlers
      const visibilityChangeHandler =
        documentAddEventListenerSpy.mock.calls.find(
          (call) => call[0] === 'visibilitychange',
        )?.[1] as Function

      const pagehideHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'pagehide',
      )?.[1] as Function

      // Step 1: Hide page - should flush
      mockDocument.visibilityState = 'hidden'
      visibilityChangeHandler()
      expect(onFlush).toHaveBeenCalledTimes(1)

      // Step 2: Show page again - should reset flag
      mockDocument.visibilityState = 'visible'
      visibilityChangeHandler()
      expect(onFlush).toHaveBeenCalledTimes(1) // Still 1, no flush on visible

      // Step 3: Navigate away - should flush again because flag was reset
      pagehideHandler()
      expect(onFlush).toHaveBeenCalledTimes(2) // ✅ Called again!
    })

    it('should call onFlush when beforeunload event is triggered', () => {
      const onFlush = vi.fn()

      setupPageLifecycleListeners({ onFlush })

      // Get the beforeunload handler
      const beforeunloadHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'beforeunload',
      )?.[1] as Function

      expect(beforeunloadHandler).toBeDefined()

      // Trigger beforeunload
      beforeunloadHandler()

      expect(onFlush).toHaveBeenCalledTimes(1)
    })

    it('should remove event listeners when cleanup function is called', () => {
      const onFlush = vi.fn()

      const cleanup = setupPageLifecycleListeners({ onFlush })

      // Verify listeners were added
      expect(addEventListenerSpy).toHaveBeenCalledTimes(2) // pagehide, beforeunload
      expect(documentAddEventListenerSpy).toHaveBeenCalledTimes(1) // visibilitychange

      // Call cleanup
      cleanup()

      // Verify listeners were removed
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'pagehide',
        expect.any(Function),
      )
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function),
      )
      expect(documentRemoveEventListenerSpy).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function),
      )
    })

    it('should handle errors in onFlush gracefully', () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const onFlush = vi.fn(() => {
        throw new Error('Flush failed')
      })

      setupPageLifecycleListeners({ onFlush })

      // Get the pagehide handler
      const pagehideHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'pagehide',
      )?.[1] as Function

      // Trigger pagehide - should not throw
      expect(() => pagehideHandler()).not.toThrow()

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Bucketeer] Failed to flush events on page lifecycle:',
        expect.any(Error),
      )

      consoleErrorSpy.mockRestore()
    })
  })
})

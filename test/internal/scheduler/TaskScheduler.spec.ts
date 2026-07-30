import { beforeEach, afterEach, expect, suite, test, vi } from 'vitest'

import { BKTConfig } from '../../../src/BKTConfig'
import { DefaultComponent } from '../../../src/internal/di/Component'
import { TaskScheduler } from '../../../src/internal/scheduler/TaskScheduler'
import { StreamingTask } from '../../../src/internal/streaming/StreamingTask'
import { buildTestComponent } from '../../utils'

// Only reconnectStreaming()'s debounce is under test here — schedulers are
// constructed but never start()ed, so their own network/timer side effects
// never enter the picture.
suite('internal/scheduler/TaskScheduler', () => {
  let scheduler: TaskScheduler | undefined
  let reconnectSpy: ReturnType<typeof vi.spyOn>

  function buildComponent(override: Partial<BKTConfig> = {}): DefaultComponent {
    return buildTestComponent(override)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    reconnectSpy = vi
      .spyOn(StreamingTask.prototype, 'reconnect')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    scheduler = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('reconnectStreaming() debounces rapid calls into exactly one reconnect() after 200ms', () => {
    scheduler = new TaskScheduler(buildComponent())

    scheduler.reconnectStreaming()
    scheduler.reconnectStreaming()
    scheduler.reconnectStreaming()

    expect(reconnectSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)

    expect(reconnectSpy).toHaveBeenCalledTimes(1)
  })

  test('reconnectStreaming() is a no-op when polling (no StreamingTask present)', () => {
    scheduler = new TaskScheduler(buildComponent({ enableStreaming: false }))

    expect(() => scheduler?.reconnectStreaming()).not.toThrow()
    vi.advanceTimersByTime(200)
    expect(reconnectSpy).not.toHaveBeenCalled()
  })

  test('stop() clears a pending debounce timer', () => {
    scheduler = new TaskScheduler(buildComponent())

    scheduler.reconnectStreaming()
    scheduler.stop()

    vi.advanceTimersByTime(200)
    expect(reconnectSpy).not.toHaveBeenCalled()
  })
})

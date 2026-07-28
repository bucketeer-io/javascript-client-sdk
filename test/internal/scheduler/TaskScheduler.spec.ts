import { beforeEach, afterEach, expect, suite, test, vi } from 'vitest'

import { BKTConfig, defineBKTConfig } from '../../../src/BKTConfig'
import { DefaultComponent } from '../../../src/internal/di/Component'
import { DataModule } from '../../../src/internal/di/DataModule'
import { InteractorModule } from '../../../src/internal/di/InteractorModule'
import { requiredInternalConfig } from '../../../src/internal/InternalConfig'
import { TaskScheduler } from '../../../src/internal/scheduler/TaskScheduler'
import { StreamingTask } from '../../../src/internal/streaming/StreamingTask'
import { TestPlatformModule } from '../../utils'
import { user1 } from '../../mocks/users'

// Only reconnectStreaming()'s debounce is under test here — schedulers are
// constructed but never start()ed, so their own network/timer side effects
// never enter the picture.
suite('internal/scheduler/TaskScheduler', () => {
  let scheduler: TaskScheduler | undefined
  let reconnectSpy: ReturnType<typeof vi.spyOn>

  function buildComponent(override: Partial<BKTConfig> = {}): DefaultComponent {
    // Object.assign, not spread: the no-spread-after-defaults lint rule forbids
    // spreading a source object over already-applied defaults.
    const config = defineBKTConfig(
      Object.assign(
        {
          apiKey: 'api_key_value',
          apiEndpoint: 'https://api.bucketeer.io',
          featureTag: 'feature_tag_value',
          appVersion: '1.2.3',
          enableStreaming: true,
          fetch: () => new Promise(() => {}), // never used — schedulers aren't started
        },
        override,
      ),
    )
    return new DefaultComponent(
      new TestPlatformModule(),
      new DataModule(user1, requiredInternalConfig(config)),
      new InteractorModule(),
    )
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

import { RequestHandler } from 'msw'
import { SetupServer, setupServer } from 'msw/node'
import { Clock, DefaultClock } from '../src/internal/Clock'
import { IdGenerator } from '../src/internal/IdGenerator'
import { BKTClient, BKTClientImpl } from '../src/BKTClient'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { Component, DefaultComponent } from '../src/internal/di/Component'
import { DataModule } from '../src/internal/di/DataModule'
import { InteractorModule } from '../src/internal/di/InteractorModule'
import { EvaluationStorageImpl } from '../src/internal/evaluation/EvaluationStorage'
import { EventStorageImpl } from '../src/internal/event/EventStorage'
import { PlatformModule } from '../src/internal/di/PlatformModule'
import { requiredInternalConfig } from '../src/internal/InternalConfig'
import { NodeIdGenerator } from '../src/internal/IdGenerator.node'
import { BrowserIdGenerator } from '../src/internal/IdGenerator.browser'
import { user1 } from './mocks/users'

export function setupServerAndListen(
  ...handlers: Array<RequestHandler>
): SetupServer {
  const server = setupServer(...handlers)
  server.listen({ onUnhandledRequest: 'error' })
  return server
}

export class FakeIdGenerator implements IdGenerator {
  constructor(private impl: IdGenerator) {}

  calls: string[] = []

  newId(): string {
    const result = this.impl.newId()
    this.calls.push(result)
    return result
  }
}

export class FakeClock implements Clock {
  private impl = new DefaultClock()
  private manualTimeSeconds?: number

  currentTimeMillisCalls: number[] = []

  currentTimeSecondsCalls: number[] = []

  setCurrentTimeSeconds(seconds: number): void {
    this.manualTimeSeconds = seconds
  }

  currentTimeMillis(): number {
    if (this.manualTimeSeconds !== undefined) {
      const result = this.manualTimeSeconds * 1000
      this.currentTimeMillisCalls.push(result)
      return result
    }
    const result = this.impl.currentTimeMillis()
    this.currentTimeMillisCalls.push(result)
    return result
  }

  currentTimeSeconds(): number {
    if (this.manualTimeSeconds !== undefined) {
      const result = this.manualTimeSeconds
      this.currentTimeSecondsCalls.push(result)
      return result
    }
    const result = this.impl.currentTimeSeconds()
    this.currentTimeSecondsCalls.push(result)
    return result
  }
}

export class TestPlatformModule implements PlatformModule {
  private _idGenerator?: IdGenerator

  idGenerator(): IdGenerator {
    if (!this._idGenerator) {
      let g: IdGenerator
      if (typeof crypto === 'undefined') {
        g = new FakeIdGenerator(new NodeIdGenerator())
      } else {
        g = new FakeIdGenerator(new BrowserIdGenerator())
      }
      this._idGenerator = g
    }
    return this._idGenerator
  }
}

// Shared component builder for the streaming/scheduler suites — same base
// config on both; callers pass suite-specific overrides (e.g. StreamingTask
// injects eventSource). Object.assign, not spread: the no-spread-after-defaults
// lint rule forbids spreading a source object over already-applied defaults.
export function buildTestComponent(
  override: Partial<BKTConfig> = {},
): DefaultComponent {
  const config = defineBKTConfig(
    Object.assign(
      {
        apiKey: 'api_key_value',
        apiEndpoint: 'https://api.bucketeer.io',
        featureTag: 'feature_tag_value',
        appVersion: '1.2.3',
        enableStreaming: true,
        fetch: () => new Promise(() => {}), // never resolves; unused in these suites
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

export const getDefaultComponent = (client: BKTClient): DefaultComponent => {
  return (client as BKTClientImpl).component as DefaultComponent
}

export const clearBKTStorages = (component: Component) => {
  if (component instanceof DefaultComponent) {
    const dataModule = component.dataModule

    ;(dataModule.evaluationStorage() as EvaluationStorageImpl).clear()
    ;(dataModule.eventStorage() as EventStorageImpl).clear()
  }
}

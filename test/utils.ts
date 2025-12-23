import { RequestHandler } from 'msw'
import { SetupServer, setupServer } from 'msw/node'
import { Clock, DefaultClock } from '../src/internal/Clock'
import { IdGenerator } from '../src/internal/IdGenerator'
import { BKTClient, BKTClientImpl } from '../src/BKTClient'
import { Component, DefaultComponent } from '../src/internal/di/Component'
import { EvaluationStorageImpl } from '../src/internal/evaluation/EvaluationStorage'
import { EventStorageImpl } from '../src/internal/event/EventStorage'
import { PlatformModule } from '../src/internal/di/PlatformModule'
import { NodeIdGenerator } from '../src/internal/IdGenerator.node'
import { BrowserIdGenerator } from '../src/internal/IdGenerator.browser'

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

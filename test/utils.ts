import { RequestHandler } from 'msw'
import { SetupServer, setupServer } from 'msw/node'
import { Clock, DefaultClock } from '../src/internal/Clock'
import { IdGenerator, createIdGenerator } from '../src/internal/IdGenerator'
import { BKTClient, BKTClientImpl } from '../src/BKTClient'
import { Component, DefaultComponent } from '../src/internal/di/Component'
import { EvaluationStorageImpl } from '../src/internal/evaluation/EvaluationStorage'
import { EventStorageImpl } from '../src/internal/event/EventStorage'

export function setupServerAndListen(
  ...handlers: Array<RequestHandler>
): SetupServer {
  const server = setupServer(...handlers)
  server.listen({ onUnhandledRequest: 'error' })
  return server
}

export class FakeIdGenerator implements IdGenerator {
  private impl = createIdGenerator()

  calls: string[] = []

  newId(): string {
    const result = this.impl.newId()
    this.calls.push(result)
    return result
  }
}

export class FakeClock implements Clock {
  private impl = new DefaultClock()

  currentTimeMillisCalls: number[] = []

  currentTimeSecondsCalls: number[] = []

  currentTimeMillis(): number {
    const result = this.impl.currentTimeMillis()
    this.currentTimeMillisCalls.push(result)
    return result
  }

  currentTimeSeconds(): number {
    const result = this.impl.currentTimeSeconds()
    this.currentTimeSecondsCalls.push(result)
    return result
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

export const clearLocalStorageIfNeeded = () => {
  if (typeof localStorage !== 'undefined') {
    localStorage.clear()
  }
}

import { RequestHandler } from 'msw'
import { SetupServer, setupServer } from 'msw/node'
import { Clock, DefaultClock } from '../src/internal/Clock'
import { DefaultIdGenerator, IdGenerator } from '../src/internal/IdGenerator'

export function setupServerAndListen(...handlers: Array<RequestHandler>): SetupServer {
  const server = setupServer(...handlers)
  server.listen({ onUnhandledRequest: 'error' })
  return server
}

export class FakeIdGenerator implements IdGenerator {
  private impl = new DefaultIdGenerator()

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

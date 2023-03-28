import { suite, test, expect, beforeEach, afterEach, assert } from 'vitest'
import {
  BKTClient,
  BKTClientImpl,
  destroyBKTClient,
  getBKTClient,
  initializeBKTClient,
} from '../src/BKTClient'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { BKTUser, defineBKTUser } from '../src/BKTUser'
import { DefaultComponent } from '../src/internal/di/Component'
import { FEATURE_ID_STRING, GOAL_ID, GOAL_VALUE, USER_ID } from './constants'
import './assertions'
import { EventType } from '../src/internal/model/Event'

function getDefaultComponent(client: BKTClient): DefaultComponent {
  return (client as BKTClientImpl).component as DefaultComponent
}

suite('e2e/events', () => {
  let config: BKTConfig
  let user: BKTUser

  beforeEach(async () => {
    config = defineBKTConfig({
      apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
      apiKey: import.meta.env.VITE_BKT_API_KEY,
      featureTag: 'javascript',
      appVersion: '1.2.3',
      fetch: window.fetch,
    })

    user = defineBKTUser({
      id: USER_ID,
    })

    await initializeBKTClient(config, user)
  })

  afterEach(() => {
    destroyBKTClient()
    localStorage.clear()
  })

  test('goal event', async () => {
    const client = getBKTClient()

    assert(client != null)

    client.track(GOAL_ID, GOAL_VALUE)

    const component = getDefaultComponent(client)

    const events = component.dataModule.eventStorage().getAll()
    expect(events).toHaveLength(3)
    expect(events.some((e) => e.type === EventType.GOAL)).toBe(true)
    await client.flush()

    expect(component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })

  test('evaluation event', async () => {
    const client = getBKTClient()

    assert(client != null)

    expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')

    const component = getDefaultComponent(client)

    const events = component.dataModule.eventStorage().getAll()
    expect(events).toHaveLength(3)
    expect(
      events.some(
        (e) =>
          e.type === EventType.EVALUATION && e.event.reason.type === 'DEFAULT',
      ),
    ).toBe(true)

    await client.flush()

    expect(component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })

  test('default evaluation event', async () => {
    const client = getBKTClient()

    assert(client != null)

    // clear event storage to mimic no-cache state
    const component = getDefaultComponent(client)
    component.dataModule.evaluationStorage().clear()

    expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('')

    const events = component.dataModule.eventStorage().getAll()
    expect(events).toHaveLength(3)
    expect(
      events.some(
        (e) =>
          e.type === EventType.EVALUATION && e.event.reason.type === 'CLIENT',
      ),
    ).toBe(true)

    await client.flush()

    expect(component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })
})

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
import { GOAL_ID, GOAL_VALUE, USER_ID } from './constants'
import './helpers'

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

  test('track', async () => {
    const client = getBKTClient()

    assert(client != null)

    client.track(GOAL_ID, GOAL_VALUE)

    const component = getDefaultComponent(client)

    expect(component.dataModule.eventStorage().getAll()).toHaveLength(3)
    await client.flush()

    expect(component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })
})

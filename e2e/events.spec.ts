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
import {
  ForbiddenException,
  NotFoundException,
  TimeoutException,
} from '../src/BKTExceptions'

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

  suite('MetricsEvent', () => {
    test('altering featureTag should not affect api request', async () => {
      // delete the feature tag setting before the request
      config.featureTag = ''

      const client = getBKTClient()
      assert(client != null)

      // might throw BadRequest error if there's problem
      await client.fetchEvaluations()
    })

    test('Altering the api key should not affect api request', async () => {
      // delete the api key setting before the request
      config.apiKey = ''

      const client = getBKTClient()
      assert(client != null)

      // might throw Unauthorized error if there's problem
      await client.fetchEvaluations()
    })

    test('Using a random string in the api key setting should throw Forbidden', async () => {
      destroyBKTClient()
      localStorage.clear()

      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: 'some-random-string',
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: window.fetch,
      })

      user = defineBKTUser({
        id: USER_ID,
      })

      await expect(() =>
        initializeBKTClient(config, user),
      ).rejects.toThrowError(ForbiddenException)
    })

    test('Using a random string in the featureTag setting should throw NotFound', async () => {
      destroyBKTClient()
      localStorage.clear()

      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        featureTag: 'some-random-feature-tag',
        appVersion: '1.2.3',
        fetch: window.fetch,
      })

      user = defineBKTUser({
        id: USER_ID,
      })

      await expect(() =>
        initializeBKTClient(config, user),
      ).rejects.toThrowError(NotFoundException)
    })

    test('Timeout', async () => {
      // setting a very low value for the timeout

      destroyBKTClient()
      localStorage.clear()

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

      await expect(() =>
        initializeBKTClient(config, user, 1),
      ).rejects.toThrowError(TimeoutException)
    })
  })
})

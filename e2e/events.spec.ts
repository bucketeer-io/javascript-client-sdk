import { suite, test, expect, beforeEach, afterEach, assert } from 'vitest'
import {
  BKTClient,
  BKTClientImpl,
  destroyBKTClient,
  getBKTClient,
} from '../src/BKTClient'
import { initializeBKTClient } from '../src/main.browser'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { BKTUser, defineBKTUser } from '../src/BKTUser'
import { DefaultComponent } from '../src/internal/di/Component'
import {
  FEATURE_ID_BOOLEAN,
  FEATURE_ID_DOUBLE,
  FEATURE_ID_INT,
  FEATURE_ID_JSON,
  FEATURE_ID_STRING,
  GOAL_ID,
  GOAL_VALUE,
  USER_ID,
} from './constants'
import './assertions'
import { EventType } from '../src/internal/model/Event'
import { ForbiddenException, TimeoutException } from '../src/BKTExceptions'
import { ApiId, MetricsEventType } from '../src/internal/model/MetricsEventData'

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
    expect(client.numberVariation(FEATURE_ID_INT, 0)).toBe(10)
    expect(client.numberVariation(FEATURE_ID_DOUBLE, 0.0)).toBe(2.1)
    expect(client.booleanVariation(FEATURE_ID_BOOLEAN, false)).toBe(true)
    expect(client.jsonVariation(FEATURE_ID_JSON, '')).toStrictEqual({
      key: 'value-1',
    })

    const component = getDefaultComponent(client)

    const events = component.dataModule.eventStorage().getAll()
    // It includes the Latency and ResponseSize metrics
    expect(events).toHaveLength(7)
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

    expect(client.stringVariation(FEATURE_ID_STRING, 'value-default')).toBe(
      'value-default',
    )
    expect(client.numberVariation(FEATURE_ID_INT, 0)).toBe(0)
    expect(client.numberVariation(FEATURE_ID_DOUBLE, 0.0)).toBe(0.0)
    expect(client.booleanVariation(FEATURE_ID_BOOLEAN, false)).toBe(false)
    expect(
      client.jsonVariation(FEATURE_ID_JSON, { key: 'value-default' }),
    ).toStrictEqual({
      key: 'value-default',
    })

    const events = component.dataModule.eventStorage().getAll()
    // It includes the Latency and ResponseSize metrics
    expect(events).toHaveLength(7)
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

      const client = getBKTClient()
      assert(client != null)
      const component = getDefaultComponent(client)

      const events = component.dataModule.eventStorage().getAll()

      expect(events).toHaveLength(1)
      expect(
        events.some((e) => {
          return (
            e.type === EventType.METRICS &&
            e.event.event['@type'] === MetricsEventType.ForbiddenError &&
            e.event.event.apiId === ApiId.GET_EVALUATIONS
          )
        }),
      ).toBe(true)

      await expect(() => client.flush()).rejects.toThrowError(
        ForbiddenException,
      )

      const events2 = component.dataModule.eventStorage().getAll()

      // error from /register_events does not get stored
      expect(events2).toHaveLength(1)

      destroyBKTClient()

      // recreate client with correct api key, and flush events
      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: window.fetch,
      })

      await initializeBKTClient(config, user)

      const client2 = getBKTClient()
      assert(client2 != null)
      const component2 = getDefaultComponent(client)

      const events3 = component2.dataModule.eventStorage().getAll()

      // error from /register_events does not get stored
      expect(events3).toHaveLength(3)
      // ForbiddenError should still exist
      expect(
        events.some((e) => {
          return (
            e.type === EventType.METRICS &&
            e.event.event['@type'] === MetricsEventType.ForbiddenError &&
            e.event.event.apiId === ApiId.GET_EVALUATIONS
          )
        }),
      ).toBe(true)

      await client2.flush()

      const events4 = component2.dataModule.eventStorage().getAll()

      // error from /register_events does not get stored
      expect(events4).toHaveLength(0)
    })

    test('Using a random string in the featureTag setting should not affect api request', async () => {
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

      await initializeBKTClient(config, user)
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

      const client = getBKTClient()
      assert(client != null)
      const component = getDefaultComponent(client)

      const events = component.dataModule.eventStorage().getAll()

      expect(events).toHaveLength(1)
      expect(
        events.some((e) => {
          return (
            e.type === EventType.METRICS &&
            e.event.event['@type'] === MetricsEventType.TimeoutError &&
            e.event.event.apiId === ApiId.GET_EVALUATIONS
          )
        }),
      ).toBe(true)

      await client.flush()

      const events2 = component.dataModule.eventStorage().getAll()
      expect(events2).toHaveLength(0)
    })
  })
})

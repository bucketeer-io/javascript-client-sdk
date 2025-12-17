import { suite, test, expect, beforeEach, afterEach, assert } from 'vitest'
import {
  BKTClient,
  BKTClientImpl,
} from '../src/BKTClient'
import { initializeBKTClient, getBKTClient, destroyBKTClient } from './module'
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
import { SDK_VERSION } from '../src/internal/version'
import { SourceId } from '../src/internal/model/SourceId'
import { fetchLike, isNodeEnvironment } from './environment'

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
      fetch: fetchLike,
      // DO NOT remove this line
      // Because the tests are asynchronous and share the same local storage,
      // It might fail randomly, having more or fewer events in the storage when checking the test.
      // So, we separate the storage from the evaluation tests to avoid flaky tests.
      storageKeyPrefix: 'events',
    })

    user = defineBKTUser({
      id: USER_ID,
    })

    await initializeBKTClient(config, user)
  })

  afterEach(() => {
    destroyBKTClient()
  })

  test('goal event', async () => {
    const client = getBKTClient()

    assert(client != null)

    await client.track(GOAL_ID, GOAL_VALUE)

    const component = getDefaultComponent(client)

    const events = await component.dataModule.eventStorage().getAll()
    expect(events).toHaveLength(3)
    expect(
      events.some(
        (e) =>
          e.type === EventType.GOAL &&
          e.event.sdkVersion === SDK_VERSION &&
          e.event.sourceId === SourceId.JAVASCRIPT,
      ),
    ).toBe(true)
    await client.flush()

    expect(await component.dataModule.eventStorage().getAll()).toHaveLength(0)
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
    expect(client.objectVariation(FEATURE_ID_JSON, '')).toStrictEqual({
      key: 'value-1',
    })

    const component = getDefaultComponent(client)

    const events = await component.dataModule.eventStorage().getAll()
    // It includes the Latency and ResponseSize metrics
    // Note: jsonVariation and objectVariation use the same FEATURE_ID_JSON,
    // so they are deduplicated into a single evaluation event
    expect(events).toHaveLength(7)
    expect(
      events.some(
        (e) =>
          e.type === EventType.EVALUATION && e.event.reason.type === 'DEFAULT' &&
          e.event.sdkVersion === SDK_VERSION &&
          e.event.sourceId === SourceId.JAVASCRIPT,
      ),
    ).toBe(true)

    await client.flush()

    expect(await component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })

  test('default evaluation event', async () => {
    const client = getBKTClient()

    assert(client != null)

    // clear event storage to mimic no-cache state
    const component = getDefaultComponent(client)
    await component.dataModule.evaluationStorage().clear()
    // load cache
    await component.dataModule.evaluationStorage().initialize()

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
    expect(
      client.objectVariation(FEATURE_ID_JSON, { key: 'value-default' }),
    ).toStrictEqual({
      key: 'value-default',
    })

    const events = await component.dataModule.eventStorage().getAll()
    // It includes the Latency and ResponseSize metrics
    // Note: jsonVariation and objectVariation use the same FEATURE_ID_JSON,
    // so they are deduplicated into a single evaluation event
    expect(events).toHaveLength(7)
    expect(
      events.some(
        (e) =>
          e.type === EventType.EVALUATION && e.event.reason.type === 'CLIENT',
      ),
    ).toBe(true)

    await client.flush()

    expect(await component.dataModule.eventStorage().getAll()).toHaveLength(0)
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

      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: 'some-random-string',
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: fetchLike,
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

      const events = await component.dataModule.eventStorage().getAll()

      expect(events).toHaveLength(0)
      expect(
        events.some((e) => {
          return (
            e.type === EventType.METRICS &&
            e.event.event['@type'] === MetricsEventType.ForbiddenError &&
            e.event.event.apiId === ApiId.GET_EVALUATIONS &&
            e.event.sdkVersion === SDK_VERSION &&
            e.event.sourceId === SourceId.JAVASCRIPT
          )
        }),
      ).toBe(false)

      await client.flush()

      const events2 = await component.dataModule.eventStorage().getAll()

      // no events should be stored
      expect(events2).toHaveLength(0)

      destroyBKTClient()

      // recreate client with correct api key, and flush events
      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: fetchLike,
      })

      await initializeBKTClient(config, user)

      const client2 = getBKTClient()
      assert(client2 != null)
      const component2 = getDefaultComponent(client)

      const events3 = await component2.dataModule.eventStorage().getAll()

      if (isNodeEnvironment) {
        // on the node environment, no events should be stored after destroying the client
        // because it's using in-memory storage
        expect(events3).toHaveLength(0)
      } else {
        // on the browser environment, we should have 2 events - latency and response size
        expect(events3).toHaveLength(2)
        // ForbiddenError should not exist
        expect(
          events3.some((e) => {
            return (
            e.type === EventType.METRICS &&
            e.event.event['@type'] === MetricsEventType.ForbiddenError &&
            e.event.event.apiId === ApiId.GET_EVALUATIONS &&
            e.event.sdkVersion === SDK_VERSION &&
            e.event.sourceId === SourceId.JAVASCRIPT
            )
          }),
        ).toBe(false)

        await client2.flush()

        const events4 = await component2.dataModule.eventStorage().getAll()

        // error from /register_events does not get stored
        expect(events4).toHaveLength(0)
      }
    })

    test('Using a random string in the featureTag setting should not affect api request', async () => {
      destroyBKTClient()

      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        featureTag: 'some-random-feature-tag',
        appVersion: '1.2.3',
        fetch: fetchLike,
      })

      user = defineBKTUser({
        id: USER_ID,
      })

      await initializeBKTClient(config, user)
    })

    test('Timeout', async () => {
      // setting a very low value for the timeout
      destroyBKTClient()

      config = defineBKTConfig({
        apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
        apiKey: import.meta.env.VITE_BKT_API_KEY,
        featureTag: 'javascript',
        appVersion: '1.2.3',
        fetch: fetchLike,
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

      const events = await component.dataModule.eventStorage().getAll()

      expect(events).toHaveLength(1)
      expect(
        events.some((e) => {
          return (
            e.type === EventType.METRICS &&
            e.event.event['@type'] === MetricsEventType.TimeoutError &&
            e.event.event.apiId === ApiId.GET_EVALUATIONS &&
            e.event.sdkVersion === SDK_VERSION &&
            e.event.sourceId === SourceId.JAVASCRIPT
          )
        }),
      ).toBe(true)

      await client.flush()

      const events2 = await component.dataModule.eventStorage().getAll()
      expect(events2).toHaveLength(0)
    })
  })
})

suite('e2e/events with wrapper SDK Source Id', () => {
  let config: BKTConfig
  let user: BKTUser

  beforeEach(async () => {
    config = defineBKTConfig({
      apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
      apiKey: import.meta.env.VITE_BKT_API_KEY,
      featureTag: 'javascript',
      appVersion: '1.2.3',
      fetch: fetchLike,
      // DO NOT remove this line
      // Because the tests are asynchronous and share the same local storage,
      // It might fail randomly, having more or fewer events in the storage when checking the test.
      // So, we separate the storage from the evaluation tests to avoid flaky tests.
      storageKeyPrefix: 'events',
      wrapperSdkSourceId: SourceId.OPEN_FEATURE_REACT_NATIVE,
      wrapperSdkVersion: '4.2.3',
    })

    user = defineBKTUser({
      id: USER_ID,
    })

    await initializeBKTClient(config, user)
  })

  afterEach(() => {
    destroyBKTClient()
  })

  test('goal event', async () => {
    const client = getBKTClient()

    assert(client != null)

    await client.track(GOAL_ID, GOAL_VALUE)

    const component = getDefaultComponent(client)

    const events = await component.dataModule.eventStorage().getAll()
    expect(events).toHaveLength(3)
    expect(
      events.some(
        (e) =>
          e.type === EventType.GOAL &&
          e.event.sdkVersion === '4.2.3' &&
          e.event.sourceId === SourceId.OPEN_FEATURE_REACT_NATIVE,
      ),
    ).toBe(true)
    await client.flush()

    expect(await component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })
})

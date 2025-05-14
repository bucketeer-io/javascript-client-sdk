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
import { TimeoutException } from '../src/BKTExceptions'
import { ApiId, MetricsEventType } from '../src/internal/model/MetricsEventData'
import { SourceId } from '../src/internal/model/SDKSourceId'

function getDefaultComponent(client: BKTClient): DefaultComponent {
  return (client as BKTClientImpl).component as DefaultComponent
}

suite('e2e/wrapper-sdk-source-id-and-version', () => {
  let config: BKTConfig
  let user: BKTUser

  beforeEach(async () => {
    config = defineBKTConfig({
      apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
      apiKey: import.meta.env.VITE_BKT_API_KEY,
      featureTag: 'javascript',
      appVersion: '1.2.3',
      fetch: window.fetch,
      // DO NOT remove this line
      // Because the tests are asynchronous and share the same local storage,
      // It might fail randomly, having more or fewer events in the storage when checking the test.
      // So, we separate the storage from the evaluation tests to avoid flaky tests.
      storageKeyPrefix: 'wrapper-sdk-events',
      wrapperSdkSourceId: SourceId.REACT_NATIVE,
      wrapperSdkVersion: '1.2.3',
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
    expect(
      events.some(
        (e) =>
          e.type === EventType.GOAL &&
          e.event.sdkVersion === '1.2.3' &&
          e.event.sourceId === SourceId.REACT_NATIVE,
      ),
    ).toBe(true)
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
    expect(client.objectVariation(FEATURE_ID_JSON, '')).toStrictEqual({
      key: 'value-1',
    })

    const component = getDefaultComponent(client)

    const events = component.dataModule.eventStorage().getAll()
    // It includes the Latency and ResponseSize metrics
    expect(events).toHaveLength(8)
    expect(
      events.some(
        (e) =>
          e.type === EventType.EVALUATION && e.event.reason.type === 'DEFAULT' &&
          e.event.sdkVersion === '1.2.3' &&
          e.event.sourceId === SourceId.REACT_NATIVE,
      ),
    ).toBe(true)

    await client.flush()

    expect(component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })

  test('metrics event', async () => {
    // setting a very low value for the timeout

    destroyBKTClient()
    localStorage.clear()

    config = defineBKTConfig({
      apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
      apiKey: import.meta.env.VITE_BKT_API_KEY,
      featureTag: 'javascript',
      appVersion: '1.2.3',
      fetch: window.fetch,
      wrapperSdkSourceId: SourceId.OPEN_FEATURE_JAVASCRIPT,
      wrapperSdkVersion: '2.2.3',
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
          e.event.event.apiId === ApiId.GET_EVALUATIONS &&
          e.event.sdkVersion === '2.2.3' &&
          e.event.sourceId === SourceId.OPEN_FEATURE_JAVASCRIPT
        )
      }),
    ).toBe(true)

    await client.flush()

    const events2 = component.dataModule.eventStorage().getAll()
    expect(events2).toHaveLength(0)
  })
})

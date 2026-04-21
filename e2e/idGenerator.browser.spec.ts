import { afterEach, assert, expect, suite, test, vi } from 'vitest'
import { BKTClient, BKTClientImpl } from '../src/BKTClient'
import { BKTConfig, defineBKTConfig } from '../src/BKTConfig'
import { BKTUser, defineBKTUser } from '../src/BKTUser'
import { DefaultComponent } from '../src/internal/di/Component'
import { UUID_V4_REGEX } from '../src/utils/regex'
import {
  FEATURE_ID_STRING,
  GOAL_ID,
  GOAL_VALUE,
  USER_ID,
} from './constants'
import { fetchLike } from './environment'

const VALID_UUID_V3 = 'ed92afad-81f1-394b-be77-347c7e170fa9'

type BrowserSdk = typeof import('../src/main.browser')

let destroyBKTClient: BrowserSdk['destroyBKTClient'] | undefined
const originalRandomUUID = globalThis.crypto.randomUUID

const loadBrowserSdk = async (): Promise<BrowserSdk> => {
  // Vitest gives us module reset before dynamic import, which is the simplest
  // way to start each scenario from a clean module state before client
  // initialization, where BrowserIdGenerator checks randomUUID support.
  vi.resetModules()
  const sdk = await import('../src/main.browser')
  destroyBKTClient = sdk.destroyBKTClient
  return sdk
}

const createConfig = (storageKeyPrefix: string): BKTConfig =>
  defineBKTConfig({
    apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
    apiKey: import.meta.env.VITE_BKT_API_KEY,
    featureTag: 'javascript',
    appVersion: '1.2.3',
    fetch: fetchLike,
    storageKeyPrefix,
  })

const createUser = (): BKTUser =>
  defineBKTUser({
    id: USER_ID,
  })

const getDefaultComponent = (client: BKTClient): DefaultComponent => {
  return (client as BKTClientImpl).component as DefaultComponent
}

const expectStoredEventIdsToBeUuidV4 = async (
  client: BKTClient,
): Promise<DefaultComponent> => {
  const component = getDefaultComponent(client)
  const events = await component.dataModule.eventStorage().getAll()

  expect(events.length).toBeGreaterThan(0)
  events.forEach((event) => {
    expect(event.id).toMatch(UUID_V4_REGEX)
  })

  return component
}

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.crypto.randomUUID = originalRandomUUID
  destroyBKTClient?.()
  destroyBKTClient = undefined
})

suite('e2e/idGenerator.browser', () => {
  test('falls back when randomUUID is unavailable', async () => {
    // @ts-expect-error - testing browser runtime without randomUUID
    globalThis.crypto.randomUUID = undefined

    const sdk = await loadBrowserSdk()

    await sdk.initializeBKTClient(
      createConfig('id-generator-browser-unavailable'),
      createUser(),
    )

    const client = sdk.getBKTClient()

    assert(client != null)

    expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')
    await client.track(GOAL_ID, GOAL_VALUE)

    const component = await expectStoredEventIdsToBeUuidV4(client)

    await client.flush()

    expect(await component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })

  test('falls back when randomUUID returns an invalid uuid v4', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(VALID_UUID_V3)

    const sdk = await loadBrowserSdk()

    await sdk.initializeBKTClient(
      createConfig('id-generator-browser-invalid'),
      createUser(),
    )

    const client = sdk.getBKTClient()

    assert(client != null)

    expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')
    await client.track(GOAL_ID, GOAL_VALUE)

    const component = await expectStoredEventIdsToBeUuidV4(client)

    await client.flush()

    expect(await component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })

  test('falls back to Math.random when both randomUUID and getRandomValues are unavailable', async () => {
    // @ts-expect-error - testing browser runtime without randomUUID
    globalThis.crypto.randomUUID = undefined
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('getRandomValues unavailable')
    })

    const sdk = await loadBrowserSdk()

    await sdk.initializeBKTClient(
      createConfig('id-generator-browser-math-random'),
      createUser(),
    )

    const client = sdk.getBKTClient()

    assert(client != null)

    expect(client.stringVariation(FEATURE_ID_STRING, '')).toBe('value-1')
    await client.track(GOAL_ID, GOAL_VALUE)

    const component = await expectStoredEventIdsToBeUuidV4(client)

    await client.flush()

    expect(await component.dataModule.eventStorage().getAll()).toHaveLength(0)
  })
})

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from 'vitest'
import { http, HttpResponse } from 'msw'
import { SetupServer } from 'msw/node'
import {
  initializeBKTClient,
  onPageLifecycleFlush,
  destroyBKTClient,
} from '../src/main.browser'
import { defineBKTConfig } from '../src/BKTConfig'
import { defineBKTUser } from '../src/BKTUser'
import { setupServerAndListen } from './utils'
import { GetEvaluationsResponse } from '../src/internal/model/response/GetEvaluationsResponse'
import { GetEvaluationsRequest } from '../src/internal/model/request/GetEvaluationsRequest'
import { user1Evaluations } from './mocks/evaluations'
import { BKTClient } from '../src/BKTClient'

describe('main.browser - initializeBKTClient integration', () => {
  let server: SetupServer

  // Every other spec file in this repo creates the MSW server once in
  // beforeAll and resets/closes it in afterEach/afterAll. This file used to
  // create (and never close) a brand-new server per test instead: with
  // several never-closed servers left listening at once, a request could
  // end up intercepted by an earlier test's leftover handler instead of the
  // current test's, which made response-timing-sensitive tests unreliable.
  beforeAll(() => {
    server = setupServerAndListen()
  })

  beforeEach(() => {
    // Mock window for browser tests
    if (typeof window === 'undefined') {
      global.window = {} as typeof window
    }
    // The singleton in src/internal/instance.ts is module-level state that
    // outlives a single test (vitest isolates per file, not per test), so
    // reset it before every test rather than only on failure paths.
    destroyBKTClient()
  })

  afterEach(() => {
    server.resetHandlers()
    vi.restoreAllMocks()
  })

  afterAll(() => {
    server.close()
  })

  it('should call setPageLifecycleCleanup when enableAutoPageLifecycleFlush is true', async () => {
    server.use(
      http.post<Record<string, never>, never, GetEvaluationsResponse>(
        `https://api.bucketeer.io/get_evaluations`,
        () => {
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        },
      ),
    )

    const config = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value',
      appVersion: '1.2.3',
      enableAutoPageLifecycleFlush: true,
    })

    const user = defineBKTUser({ id: 'user_id_1' })

    // Spy on setPageLifecycleCleanup and setupPageLifecycleListeners
    const instanceModule = await import('../src/internal/instance')
    const setCleanupSpy = vi.spyOn(instanceModule, 'setPageLifecycleCleanup')

    const pageLifecycleModule = await import('../src/utils/pageLifecycle')
    const setupListenersSpy = vi
      .spyOn(pageLifecycleModule, 'setupPageLifecycleListeners')
      .mockReturnValue(vi.fn())

    // Initialize the client
    await initializeBKTClient(config, user)

    // Verify setupPageLifecycleListeners was called
    expect(setupListenersSpy).toHaveBeenCalledTimes(1)
    expect(setupListenersSpy).toHaveBeenCalledWith({
      onFlush: onPageLifecycleFlush,
    })

    // Verify setPageLifecycleCleanup was called with cleanup function
    expect(setCleanupSpy).toHaveBeenCalledTimes(1)
    expect(setCleanupSpy).toHaveBeenCalledWith(expect.any(Function))
  })

  it('should NOT setup page lifecycle when enableAutoPageLifecycleFlush is false', async () => {
    server.use(
      http.post<Record<string, never>, never, GetEvaluationsResponse>(
        `https://api.bucketeer.io/get_evaluations`,
        () => {
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        },
      ),
    )

    const config = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value',
      appVersion: '1.2.3',
      enableAutoPageLifecycleFlush: false,
    })

    const user = defineBKTUser({ id: 'user_id_1' })

    // Spy on setPageLifecycleCleanup
    const instanceModule = await import('../src/internal/instance')
    const setCleanupSpy = vi.spyOn(instanceModule, 'setPageLifecycleCleanup')

    const pageLifecycleModule = await import('../src/utils/pageLifecycle')
    const setupListenersSpy = vi.spyOn(
      pageLifecycleModule,
      'setupPageLifecycleListeners',
    )

    // Initialize the client
    await initializeBKTClient(config, user)

    // Verify setupPageLifecycleListeners was NOT called
    expect(setupListenersSpy).not.toHaveBeenCalled()

    // Verify setPageLifecycleCleanup was NOT called
    expect(setCleanupSpy).not.toHaveBeenCalled()
  })

  it('should NOT wire page lifecycle listeners when the client is destroyed while init is still pending', async () => {
    // Gate the response so the fetch stays in flight until we manually release it.
    let releaseResponse: () => void
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })

    server.use(
      http.post<Record<string, never>, never, GetEvaluationsResponse>(
        `https://api.bucketeer.io/get_evaluations`,
        async () => {
          await responseGate
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        },
      ),
    )

    const config = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value',
      appVersion: '1.2.3',
      enableAutoPageLifecycleFlush: true,
    })

    const user = defineBKTUser({ id: 'user_id_1' })

    const instanceModule = await import('../src/internal/instance')
    const setCleanupSpy = vi.spyOn(instanceModule, 'setPageLifecycleCleanup')

    const pageLifecycleModule = await import('../src/utils/pageLifecycle')
    const setupListenersSpy = vi
      .spyOn(pageLifecycleModule, 'setupPageLifecycleListeners')
      .mockReturnValue(vi.fn())

    // Start init but don't await it yet, then destroy while it's still pending.
    const initPromise = initializeBKTClient(config, user)
    destroyBKTClient()

    releaseResponse!()
    await initPromise

    // The client was destroyed before init resolved, so the listeners it
    // would have wired should never be attached.
    expect(setupListenersSpy).not.toHaveBeenCalled()
    expect(setCleanupSpy).not.toHaveBeenCalled()
  })

  it('should NOT wire page lifecycle listeners when a stale init resolves after a different client has already finished initializing', async () => {
    const configA = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value_a',
      appVersion: '1.2.3',
      enableAutoPageLifecycleFlush: true,
    })
    const configB = defineBKTConfig({
      apiKey: 'api_key_value',
      apiEndpoint: 'https://api.bucketeer.io',
      featureTag: 'feature_tag_value_b',
      appVersion: '1.2.3',
      enableAutoPageLifecycleFlush: false,
    })

    const user = defineBKTUser({ id: 'user_id_1' })

    // Gate both A's and B's requests independently (identified by their
    // featureTag in the request body, sent as GetEvaluationsRequest.tag),
    // so the test controls exactly when each resolves instead of relying
    // on which one happens to reach the real fetch() first.
    let releaseAResponse: () => void
    const aResponseGate = new Promise<void>((resolve) => {
      releaseAResponse = resolve
    })
    let releaseBResponse: () => void
    const bResponseGate = new Promise<void>((resolve) => {
      releaseBResponse = resolve
    })

    server.use(
      http.post<Record<string, never>, GetEvaluationsRequest, GetEvaluationsResponse>(
        `https://api.bucketeer.io/get_evaluations`,
        async ({ request }) => {
          const body = (await request.json()) as GetEvaluationsRequest
          if (body.tag === configA.featureTag) {
            await aResponseGate
          } else if (body.tag === configB.featureTag) {
            await bResponseGate
          }
          return HttpResponse.json({
            evaluations: user1Evaluations,
            userEvaluationsId: 'user_evaluation_id_value',
          })
        },
      ),
    )

    const instanceModule = await import('../src/internal/instance')
    const setCleanupSpy = vi.spyOn(instanceModule, 'setPageLifecycleCleanup')

    const pageLifecycleModule = await import('../src/utils/pageLifecycle')
    const setupListenersSpy = vi
      .spyOn(pageLifecycleModule, 'setupPageLifecycleListeners')
      .mockReturnValue(vi.fn())

    // 1. Start init for client A. Its request is gated and stays pending.
    const initPromiseA = initializeBKTClient(configA, user)

    // 2. Destroy while A's init is still pending: clears the singleton and
    //    stops A's scheduler, but does NOT cancel A's in-flight promise.
    destroyBKTClient()

    // 3. Re-init as client B. Its request is gated too, so this call stays
    //    pending until we explicitly release it below.
    const initPromiseB = initializeBKTClient(configB, user)

    // 4. Let B finish completely before touching A's stale response, so the
    //    ordering of "B finished" vs "A finally resolves" is deterministic.
    releaseBResponse!()
    await initPromiseB

    // Sanity check: B's own init correctly skipped listener wiring.
    expect(setupListenersSpy).not.toHaveBeenCalled()
    expect(setCleanupSpy).not.toHaveBeenCalled()

    // 5. Only now release A's stale gated response.
    // initializeBKTClient(configA, ...) resumes with clientB (not clientA,
    // and not null) as the current singleton.
    releaseAResponse!()
    await initPromiseA

    // A's stale resolution must NOT wire listeners on B's behalf, even
    // though getBKTClient() is non-null (it's B's client, not A's).
    expect(setupListenersSpy).not.toHaveBeenCalled()
    expect(setCleanupSpy).not.toHaveBeenCalled()
  })
})

describe('main.browser - onPageLifecycleFlush', () => {
  it('should call getBKTClient().flush() when invoked', async () => {
    // Create a mock flush function
    const mockFlush = vi.fn().mockResolvedValue(undefined)

    // Create a mock client with the flush method
    const mockClient = {
      flush: mockFlush,
    }

    // Import and mock getBKTClient
    const BKTClientModule = await import('../src/BKTClient')
    const getBKTClientSpy = vi
      .spyOn(BKTClientModule, 'getBKTClient')
      .mockReturnValue(mockClient as unknown as BKTClient)

    // Call the flush handler
    await onPageLifecycleFlush()

    // Verify getBKTClient was called
    expect(getBKTClientSpy).toHaveBeenCalledTimes(1)

    // Verify flush was called
    expect(mockFlush).toHaveBeenCalledTimes(1)

    // Cleanup
    getBKTClientSpy.mockRestore()
  })

  it('should handle flush errors gracefully without throwing', async () => {
    // Create a mock flush function that rejects
    const mockFlush = vi.fn().mockRejectedValue(new Error('Network error'))

    // Create a mock client with the flush method
    const mockClient = {
      flush: mockFlush,
    }

    // Mock console.warn to verify error logging
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {})

    // Import and mock getBKTClient
    const BKTClientModule = await import('../src/BKTClient')
    const getBKTClientSpy = vi
      .spyOn(BKTClientModule, 'getBKTClient')
      .mockReturnValue(mockClient as unknown as BKTClient)

    // Call should not throw
    await expect(onPageLifecycleFlush()).resolves.toBeUndefined()

    // Verify flush was attempted
    expect(mockFlush).toHaveBeenCalledTimes(1)

    // Verify error was logged
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Bucketeer] Failed to flush events on page lifecycle:',
      expect.any(Error),
    )

    // Cleanup
    getBKTClientSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  it('should handle null client gracefully', async () => {
    // Import and mock getBKTClient to return null
    const BKTClientModule = await import('../src/BKTClient')
    const getBKTClientSpy = vi
      .spyOn(BKTClientModule, 'getBKTClient')
      .mockReturnValue(null)

    // Call should not throw even when client is null
    await expect(onPageLifecycleFlush()).resolves.toBeUndefined()

    // Verify getBKTClient was called
    expect(getBKTClientSpy).toHaveBeenCalledTimes(1)

    // Cleanup
    getBKTClientSpy.mockRestore()
  })
})

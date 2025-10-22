import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { SetupServer } from 'msw/node'
import { initializeBKTClient } from '../src/main.browser'
import { defineBKTConfig } from '../src/BKTConfig'
import { defineBKTUser } from '../src/BKTUser'
import { setupServerAndListen } from './utils'
import { GetEvaluationsResponse } from '../src/internal/model/response/GetEvaluationsResponse'
import { user1Evaluations } from './mocks/evaluations'

describe('main.browser - initializeBKTClient integration', () => {
  let server: SetupServer

  beforeEach(() => {
    server = setupServerAndListen()
    // Mock window for browser tests
    if (typeof window === 'undefined') {
      global.window = {} as typeof window
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
      onFlush: expect.any(Function),
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
})

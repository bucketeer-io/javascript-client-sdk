import {
  initializeBKTClient,
  defineBKTConfig,
  defineBKTUser,
  getBKTClient,
  destroyBKTClient,
} from '@bucketeer/js-client-sdk'
import { EventSourceAdapter } from './eventSourceAdapter'
import type { Mode } from './types'

const FEATURE_TAG = import.meta.env.VITE_BKT_FEATURE_TAG ?? 'feature-tag'
const STRING_FEATURE_ID = import.meta.env.VITE_BKT_FEATURE_ID ?? 'feature_id'
const GOAL_ID = import.meta.env.VITE_BKT_GOAL_ID ?? 'goal_id'

const AUTO_INIT_FLAG = true

// Vite exposes every custom env var as a string, so compare against the
// exact string 'true' rather than relying on truthiness ('false' is truthy).
const initialMode: Mode =
  import.meta.env.VITE_BKT_ENABLE_STREAMING !== 'true'
    ? 'polling'
    : import.meta.env.VITE_BKT_USE_CUSTOM_EVENT_SOURCE === 'true'
      ? 'custom'
      : 'streaming'

export default async function start(root: HTMLElement) {
  const logsEl = root.querySelector('#logs')
  const buttonEl = root.querySelector<HTMLButtonElement>('#track_goal')
  const flushEl = root.querySelector<HTMLButtonElement>('#flush')
  const setUserAttributesEl = root.querySelector<HTMLButtonElement>('#set_user_attributes')
  const viewUserAttributesEl = root.querySelector<HTMLButtonElement>('#view_user_attributes')
  const initEl = root.querySelector<HTMLButtonElement>('#init')
  const destroyEl = root.querySelector<HTMLButtonElement>('#destroy')
  const clearLogEl = root.querySelector<HTMLButtonElement>('#clear_log')
  const modeEls = root.querySelectorAll<HTMLInputElement>('input[name="mode"]')
  const flagValueEl = root.querySelector('#flag_value_text')

  let listenerId: string | null | undefined = null
  let initializing = false
  let mode: Mode = initialMode

  modeEls.forEach((input) => {
    input.checked = input.value === initialMode
  })

  function log(message: string) {
    if (logsEl) {
      const logLine = document.createElement('div')
      logLine.textContent = `[${new Date().toLocaleTimeString()}] ${message}`
      logsEl.appendChild(logLine)
      logsEl.scrollTop = logsEl.scrollHeight
    }
    console.log(message)
  }

  function refreshFlagValue() {
    const client = getBKTClient()
    const value = client?.stringVariation(STRING_FEATURE_ID, 'default_value')
    if (flagValueEl) flagValueEl.textContent = value ?? '-'
  }

  function updateButtons(initialized: boolean) {
    if (buttonEl) buttonEl.disabled = !initialized
    if (flushEl) flushEl.disabled = !initialized
    if (setUserAttributesEl) setUserAttributesEl.disabled = !initialized
    if (viewUserAttributesEl) viewUserAttributesEl.disabled = !initialized
    if (initEl) initEl.disabled = initialized
    if (destroyEl) destroyEl.disabled = !initialized
    modeEls.forEach((input) => {
      input.disabled = initialized
    })
  }

  const handleInit = async () => {
    if (initializing) return
    initializing = true
    if (initEl) initEl.disabled = true

    const apiEndpoint = import.meta.env.VITE_BKT_API_ENDPOINT
    const apiKey = import.meta.env.VITE_BKT_API_KEY
    if (!apiEndpoint || !apiKey) {
      initializing = false
      if (initEl) initEl.disabled = false
      const message =
        'Set VITE_BKT_API_ENDPOINT and VITE_BKT_API_KEY in example/.env, then reload'
      log(message)
      return
    }

    const selected = root.querySelector<HTMLInputElement>('input[name="mode"]:checked')
    mode = (selected?.value as Mode | undefined) ?? 'polling'
    // Lock the radios in now, before the async initialization below can be
    // interrupted by a mode change that no longer matches what was captured.
    // The failure path further down re-enables them via updateButtons(false).
    modeEls.forEach((input) => {
      input.disabled = true
    })

    log(`Initializing BKTClient in ${mode} mode...`)
    try {
      // Built inside the try: defineBKTConfig/defineBKTUser validate their
      // input and can throw synchronously (e.g. a malformed
      // VITE_BKT_API_ENDPOINT), which must still hit the catch below so
      // Initialize and the mode radios don't stay stuck disabled.
      const config = defineBKTConfig({
        apiEndpoint,
        apiKey,
        featureTag: FEATURE_TAG,
        appVersion: '1.2.3',
        pollingInterval: 60_000, // minimum allowed
        enableStreaming: mode !== 'polling',
        // Only the `custom` mode replaces the built-in SSE transport. Kept as a
        // single conditional spread of one known key (never a merged options
        // object), so the eslint-disable below is trivially safe: there is no
        // earlier `eventSource` property for an undefined value to override.
        // eslint-disable-next-line custom-rules/no-spread-after-defaults
        ...(mode === 'custom' ? { eventSource: EventSourceAdapter } : {}),
      })

      const user = defineBKTUser({
        id: 'user_id_1',
      })

      await initializeBKTClient(config, user)
      log('Initialization completed')
      updateButtons(true)

      const client = getBKTClient()
      refreshFlagValue()
      log(`Value for ${STRING_FEATURE_ID}: ${flagValueEl?.textContent ?? ''}`)

      listenerId = client?.addEvaluationUpdateListener(() => {
        refreshFlagValue()
        log(`Evaluation updated. Value for ${STRING_FEATURE_ID}: ${flagValueEl?.textContent ?? ''}`)
      })
    } catch (error) {
      log(`Initialization failed: ${error}`)
      listenerId = null
      destroyBKTClient()
      updateButtons(false)
    } finally {
      initializing = false
    }
  }

  const handleDestroy = () => {
    log('Destroying BKTClient...')
    if (listenerId) {
      getBKTClient()?.removeEvaluationUpdateListener(listenerId)
      listenerId = null
    }
    destroyBKTClient()
    log('BKTClient destroyed')
    updateButtons(false)
  }

  initEl?.addEventListener('click', handleInit)
  destroyEl?.addEventListener('click', handleDestroy)

  clearLogEl?.addEventListener('click', () => {
    if (logsEl) logsEl.textContent = ''
  })

  buttonEl?.addEventListener('click', async () => {
    try {
      await getBKTClient()?.track(GOAL_ID, 1)
      log('Goal tracked')
    } catch (error) {
      log(`Track failed: ${error}`)
    }
  })

  flushEl?.addEventListener('click', () => {
    const client = getBKTClient()
    if (client) {
      log('Flushing events...')
      client.flush()
        .then(() => log('Flushed'))
        .catch((error) => log(`Flush failed: ${error}`))
    }
  })

  setUserAttributesEl?.addEventListener('click', async () => {
    const client = getBKTClient()
    if (client) {
      try {
        await client.updateUserAttributes({ kYear: 'value_2025' })
        log('User attributes updated')
      } catch (error) {
        log(`Update user attributes failed: ${error}`)
      }
    }
  })

  viewUserAttributesEl?.addEventListener('click', () => {
    const client = getBKTClient()
    if (client) {
      const user = client.currentUser()
      log(`Current user attributes: ${JSON.stringify(user.attributes)}`)
    }
  })

  window.addEventListener('beforeunload', () => {
    handleDestroy()
  })

  updateButtons(false)

  if (AUTO_INIT_FLAG) {
    handleInit()
  } else {
    log('Auto-init disabled. Click "Initialize" to start.')
  }
}

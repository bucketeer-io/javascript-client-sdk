import {
  initializeBKTClient,
  defineBKTConfig,
  defineBKTUser,
  getBKTClient,
  destroyBKTClient,
} from '@bucketeer/js-client-sdk'
import type { EventSourceLike, EventSourceLikeInit } from '@bucketeer/js-client-sdk'
import { loggingFetch } from './loggingFetch'
import { EventSourceAdapter } from './eventSourceAdapter'
import type { Mode, StreamEvent, StreamReporter } from './types'

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

// Binds the shared reporter to the EventSourceLike constructor contract
// (EventSourceLike itself is a bare `new (url, init)` signature with nowhere
// to pass extra constructor args).
const makeEventSource = (report: StreamReporter): EventSourceLike =>
  class extends EventSourceAdapter {
    constructor(url: string, init?: EventSourceLikeInit) {
      super(url, init, report)
    }
  }

// Mirrors src/internal/streaming/httpStatus.ts's TERMINAL_STATUSES. The SDK
// does not export that list, so this example keeps its own copy purely to
// label the status panel; it has no effect on how the SDK itself retries.
const TERMINAL_STATUSES = new Set([
  401, 403, 404, 405, 406, 410, 414, 415, 431, 451,
])

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
  const statusModeEl = root.querySelector('#status_mode')
  const statusStreamStateEl = root.querySelector('#status_stream_state')
  const statusLastUpdateEl = root.querySelector('#status_last_update')
  const statusUpdateCountEl = root.querySelector('#status_update_count')
  const statusHeartbeatCountEl = root.querySelector('#status_heartbeat_count')
  const flagValueEl = root.querySelector('#flag_value_text')

  let listenerId: string | null | undefined = null
  let initializing = false
  let mode: Mode = initialMode
  let streamState = 'idle'
  let updateCount = 0
  let heartbeatCount = 0
  // Mirrors StreamingTask's own terminalFailure flag: once a terminal status
  // (e.g. a bad API key) closes the stream, the SDK never retries streaming
  // again for this client, only the polling fallback keeps running. Sticky
  // for the same reason: without it, each later get_evaluations request
  // would flip the display back to "polling fallback" and hide the
  // terminal state that actually explains why streaming stopped.
  let terminalFailure = false
  // initializeBKTClient() always fires one bootstrap get_evaluations request
  // alongside opening the stream (BKTClient.scheduleAndFetch), whether or not
  // streaming ever fails. Set true right before that call and consumed by
  // exactly the next get_evaluations request seen, so only that one bootstrap
  // request is ignored: a real fallback request racing in before init settles
  // (the stream can fail before the bootstrap fetch resolves) still reports
  // 'polling fallback' correctly.
  let awaitingBootstrapFetch = false

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

  // The stream state span is the only live region in the panel, so it is
  // rewritten only when the text really changes. Assigning the same value
  // again would still make a screen reader announce it, and renderStatus()
  // runs on every heartbeat (roughly every 25s).
  function renderStreamState() {
    if (statusStreamStateEl && statusStreamStateEl.textContent !== streamState) {
      statusStreamStateEl.textContent = streamState
    }
  }

  function renderStatus() {
    if (statusModeEl) statusModeEl.textContent = mode
    renderStreamState()
    if (statusUpdateCountEl) statusUpdateCountEl.textContent = String(updateCount)
    if (statusHeartbeatCountEl) statusHeartbeatCountEl.textContent = String(heartbeatCount)
  }

  function stampLastUpdate() {
    if (statusLastUpdateEl) statusLastUpdateEl.textContent = new Date().toLocaleTimeString()
  }

  function setStreamState(next: string) {
    streamState = next
    renderStatus()
  }

  function refreshFlagValue() {
    const client = getBKTClient()
    const value = client?.stringVariation(STRING_FEATURE_ID, 'default_value')
    if (flagValueEl) flagValueEl.textContent = value ?? '-'
  }

  // Derives a stream status purely from observed network activity. The SDK
  // itself exposes no connection-status API (BKTClient has no isStreaming
  // and no connection state), so this is this example's own inference, not
  // something the SDK reports.
  function report(event: StreamEvent) {
    switch (event.kind) {
      case 'request':
        log(`-> ${event.method} ${event.path}`)
        if (event.path === '/stream_evaluations') {
          setStreamState('connecting')
        } else if (
          event.path === '/get_evaluations' &&
          mode !== 'polling' &&
          !terminalFailure
        ) {
          if (awaitingBootstrapFetch) {
            awaitingBootstrapFetch = false
          } else {
            setStreamState('polling fallback')
          }
        }
        break
      case 'response':
        log(`<- ${event.status} ${event.path}`)
        if (
          event.path === '/stream_evaluations' &&
          event.status >= 200 &&
          event.status < 300
        ) {
          setStreamState('open')
        }
        break
      case 'open':
        setStreamState('open')
        break
      case 'sse':
        log(`event: ${event.name} (${event.chars} chars)`)
        stampLastUpdate()
        break
      case 'heartbeat':
        heartbeatCount++
        stampLastUpdate()
        renderStatus()
        break
      case 'closed':
        if (mode !== 'polling') {
          if (
            event.terminal ||
            (event.status !== undefined && TERMINAL_STATUSES.has(event.status))
          ) {
            terminalFailure = true
            setStreamState('stopped permanently')
          } else {
            setStreamState('disconnected')
          }
        }
        break
      case 'note':
        log(event.text)
        break
    }
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
      if (statusStreamStateEl) statusStreamStateEl.textContent = message
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
    updateCount = 0
    heartbeatCount = 0
    terminalFailure = false
    if (statusLastUpdateEl) statusLastUpdateEl.textContent = '-'
    setStreamState(mode === 'polling' ? 'polling' : 'connecting')

    log('Initializing BKTClient...')
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
        fetch: loggingFetch(report),
        pollingInterval: 60_000, // minimum allowed; makes the polling fallback visible fast
        enableStreaming: mode !== 'polling',
        // Only the `custom` mode replaces the built-in SSE transport. Kept as a
        // single conditional spread of one known key (never a merged options
        // object), so the eslint-disable below is trivially safe: there is no
        // earlier `eventSource` property for an undefined value to override.
        // eslint-disable-next-line custom-rules/no-spread-after-defaults
        ...(mode === 'custom' ? { eventSource: makeEventSource(report) } : {}),
      })

      const user = defineBKTUser({
        id: 'user_id_1',
      })

      awaitingBootstrapFetch = true
      await initializeBKTClient(config, user)
      log('Initialization completed')
      updateButtons(true)

      const client = getBKTClient()
      refreshFlagValue()
      log(`Value for ${STRING_FEATURE_ID}: ${flagValueEl?.textContent ?? ''}`)

      listenerId = client?.addEvaluationUpdateListener(() => {
        updateCount++
        stampLastUpdate()
        renderStatus()
        refreshFlagValue()
        log(`Evaluation updated. Value for ${STRING_FEATURE_ID}: ${flagValueEl?.textContent ?? ''}`)
      })
    } catch (error) {
      log(`Initialization failed: ${error}`)
      listenerId = null
      destroyBKTClient()
      updateButtons(false)
      setStreamState('idle')
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
    setStreamState('idle')
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
  renderStatus()

  if (AUTO_INIT_FLAG) {
    handleInit()
  } else {
    log('Auto-init disabled. Click "Initialize" to start.')
  }
}

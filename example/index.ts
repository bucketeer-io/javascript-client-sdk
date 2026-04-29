import {
  initializeBKTClient,
  defineBKTConfig,
  defineBKTUser,
  getBKTClient,
  destroyBKTClient,
} from '@bucketeer/js-client-sdk'

const FEATURE_TAG = 'feature-tag' // replace here
const STRING_FEATURE_ID = 'feature_id' // replace here
const GOAL_ID = 'goal_id' // replace here

const AUTO_INIT_FLAG = true

export default async function start(root: HTMLElement) {
  const logsEl = root.querySelector('#logs')
  const buttonEl = root.querySelector<HTMLButtonElement>('#track_goal')
  const flushEl = root.querySelector<HTMLButtonElement>('#flush')
  const setUserAttributesEl = root.querySelector<HTMLButtonElement>('#set_user_attributes')
  const viewUserAttributesEl = root.querySelector<HTMLButtonElement>('#view_user_attributes')
  const initEl = root.querySelector<HTMLButtonElement>('#init')
  const destroyEl = root.querySelector<HTMLButtonElement>('#destroy')

  let listenerId: string | null | undefined = null
  let initializing = false

  function log(message: string) {
    if (logsEl) {
      const logLine = document.createElement('div')
      logLine.textContent = `[${new Date().toLocaleTimeString()}] ${message}`
      logsEl.appendChild(logLine)
      logsEl.scrollTop = logsEl.scrollHeight
    }
    console.log(message)
  }

  function updateButtons(initialized: boolean) {
    if (buttonEl) buttonEl.disabled = !initialized
    if (flushEl) flushEl.disabled = !initialized
    if (initEl) initEl.disabled = initialized
    if (destroyEl) destroyEl.disabled = !initialized
  }

  const handleInit = async () => {
    if (initializing) return
    initializing = true
    if (initEl) initEl.disabled = true
    const config = defineBKTConfig({
      apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
      apiKey: import.meta.env.VITE_BKT_API_KEY,
      featureTag: FEATURE_TAG,
      appVersion: '1.2.3',
      fetch: window.fetch,
    })

    const user = defineBKTUser({
      id: 'user_id_1',
    })

    log('Initializing BKTClient...')
    try {
      await initializeBKTClient(config, user)
      initializing = false
      log('Initialization completed')
      updateButtons(true)

      const client = getBKTClient()
      const value = client?.stringVariation(STRING_FEATURE_ID, 'default_value')
      log(`Value for ${STRING_FEATURE_ID}: ${value}`)

      listenerId = client?.addEvaluationUpdateListener(() => {
        log('Evaluation updated')
        const newValue = client?.stringVariation(STRING_FEATURE_ID, 'default_value')
        log(`Value for ${STRING_FEATURE_ID}: ${newValue}`)
      })
    } catch (error) {
      initializing = false
      log(`Initialization failed: ${error}`)
      listenerId = null
      destroyBKTClient()
      updateButtons(false)
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

  if (AUTO_INIT_FLAG) {
    handleInit()
  } else {
    log('Auto-init disabled. Click "Initialize" to start.')
  }
}

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
  const buttonEl = root.querySelector('#track_goal') as HTMLButtonElement
  const flushEl = root.querySelector('#flush') as HTMLButtonElement
  const setUserAttributesEl = root.querySelector('#set_user_attributes') as HTMLButtonElement
  const viewUserAttributesEl = root.querySelector('#view_user_attributes') as HTMLButtonElement
  const initEl = root.querySelector('#init') as HTMLButtonElement
  const destroyEl = root.querySelector('#destroy') as HTMLButtonElement

  let listenerId: string | null | undefined = null

  function log(message: string) {
    if (logsEl) {
      logsEl.innerHTML += `[${new Date().toLocaleTimeString()}] ${message}<br/>`
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
      log(`Initialization failed: ${error}`)
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

  buttonEl?.addEventListener('click', () => {
    getBKTClient()?.track(GOAL_ID, 1)
    log('Goal tracked')
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

  setUserAttributesEl?.addEventListener('click', () => {
    const client = getBKTClient()
    if (client) {
      client.updateUserAttributes({ kYear: 'value_2025' })
      log('User attributes updated')
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

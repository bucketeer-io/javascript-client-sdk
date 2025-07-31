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

export default async function start(root: HTMLElement) {
  const logsEl = root.querySelector('#logs')
  const buttonEl = root.querySelector('#track_goal')
  const flushEl = root.querySelector('#flush')
  const setUserAttributesEl = root.querySelector('#set_user_attributes')
  const viewUserAttributesEl = root.querySelector('#view_user_attributes')

  let listenerId: string | null | undefined = null

  function log(message: string) {
    if (logsEl) {
      logsEl.innerHTML += message + '<br/>'
    }
    console.log(message)
  }

  buttonEl?.addEventListener('click', () => {
    getBKTClient()?.track(GOAL_ID, 1 /* goal value */)
    log('goal tracked')
  })

  flushEl?.addEventListener('click', () => {
    const client = getBKTClient()
    if (client) {
      // you can always force-send saved events
      const flushPromise = client.flush()
      log('flushing...')
      flushPromise
        .then(() => log('flushed'))
        .catch((error) => log(`flush failed: ${error}`))
    }
  })

  setUserAttributesEl?.addEventListener('click', () => {
    const client = getBKTClient()
    if (client) {
      // you can set custom attributes for the user
      client.updateUserAttributes({ kYear: 'value_2025' })
      log('user attributes set')
    }
  })

  viewUserAttributesEl?.addEventListener('click', () => {
    const client = getBKTClient()
    if (client) {
      // you can view current user attributes
      const user = client.currentUser()
      log(`current user attributes: ${JSON.stringify(user.attributes)}`)
    }
  })

  const config = defineBKTConfig({
    apiEndpoint: import.meta.env.VITE_BKT_API_ENDPOINT,
    apiKey: import.meta.env.VITE_BKT_API_KEY,
    featureTag: FEATURE_TAG,
    appVersion: '1.2.3',
    fetch: window.fetch,
  })

  const user = defineBKTUser({
    id: 'user_id_1',
    // you can also set custom attributes
    // customAttributes: { key: 'value'}
  })

  log('initialize BKTClient')

  const initialFetchPromise = initializeBKTClient(config, user)

  initialFetchPromise
    .then(() => {
      log('initialization completed')
      buttonEl?.removeAttribute('disabled')
      flushEl?.removeAttribute('disabled')

      const value = getBKTClient()?.stringVariation(
        STRING_FEATURE_ID,
        'default_value',
      )
      log(`value for feature_id: ${value}`)
    })
    .catch((error) => {
      log(`initialization failed: ${error}`)
    })

  window.addEventListener('beforeunload', () => {
    log('destroy BKTClient')
    if (listenerId) {
      getBKTClient()?.removeEvaluationUpdateListener(listenerId)
    }
    destroyBKTClient()
  })

  log('fetching evaluations...')

  const client = getBKTClient()

  listenerId = client?.addEvaluationUpdateListener(() => {
    log('evaluation updated')
    const value = client?.stringVariation(STRING_FEATURE_ID, 'default_value')
    log(`value for feature_id: ${value}`)
  })
}

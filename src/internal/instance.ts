import { BKTClient } from '../BKTClient'

const KEY = 'BKTCLIENT_INSTANCE'
const _instance: Map<string, BKTClient> = new Map()

export const getInstance = (): BKTClient | null => {
  return _instance.get(KEY) ?? null
}

export const setInstance = (client: BKTClient) => {
  _instance.set(KEY, client)
}

export const clearInstance = () => {
  _instance.delete(KEY)
}

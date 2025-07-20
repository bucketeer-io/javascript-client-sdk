
import { afterEach } from 'vitest'
import { setFetchProvider } from './environment'

setFetchProvider(window.fetch)

afterEach(() => {
  localStorage.clear()
})

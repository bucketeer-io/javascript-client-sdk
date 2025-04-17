
import { afterEach } from 'vitest'
import { setFetchProvider } from './fetchProvider'

setFetchProvider(window.fetch)

afterEach(() => {
  localStorage.clear()
})

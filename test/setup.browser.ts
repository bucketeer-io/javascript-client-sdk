import { randomUUID, webcrypto } from 'node:crypto'
import { afterEach } from 'vitest'

// setup crypto APIs used by the browser generator
Object.defineProperty(global.self, 'crypto', {
  value: {
    randomUUID,
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
  },
})

afterEach(() => {
  localStorage.clear()
})

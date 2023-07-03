import { randomUUID } from 'node:crypto'
import { afterEach } from 'vitest'

// setup crypto.randomUUID
Object.defineProperty(global.self, 'crypto', {
  value: {
    randomUUID: randomUUID,
  },
})

afterEach(() => {
  localStorage.clear()
})

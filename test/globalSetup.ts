import { randomUUID } from 'node:crypto'

// setup crypto.randomUUID
Object.defineProperty(global.self, 'crypto', {
  value: {
    randomUUID: randomUUID,
  },
})

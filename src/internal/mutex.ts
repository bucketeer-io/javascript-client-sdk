import { Mutex } from 'async-mutex'

async function runWithMutex<T>(
  mutex: Mutex,
  fn: () => Promise<T>,
): Promise<T> {
  let release: (() => void) | undefined
  try {
    release = await mutex.acquire()
    return await fn()
  } catch (error) {
    throw error
  } finally {
    release?.()
  }
}

export {
  runWithMutex
}

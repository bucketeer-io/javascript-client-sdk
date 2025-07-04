import { Mutex } from 'async-mutex'

async function runWithMutex<T>(
  mutex: Mutex,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await mutex.acquire()
  try {
    return await fn()
  } catch (error) {
    throw error
  } finally {
    release() // Always release the mutex to avoid deadlocks
  }
}

export {
  runWithMutex
}

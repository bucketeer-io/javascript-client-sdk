export function isRecoverableStatus(status: number | undefined): boolean {
  if (status === undefined) {
    return true
  }
  if (status >= 400 && status < 500) {
    return status === 400 || status === 408 || status === 429
  }
  return true
}

// Authentication failures — retrying with the same API key can never succeed.
export function isTerminalStatus(status: number | undefined): boolean {
  return status === 401 || status === 403
}

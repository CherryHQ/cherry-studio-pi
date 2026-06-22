const UNKNOWN_WORKER_ERROR_MESSAGE = 'Unknown error'

export function getWorkerErrorMessage(error: unknown, seen = new WeakSet<object>()): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (!error || typeof error !== 'object') return UNKNOWN_WORKER_ERROR_MESSAGE
  if (seen.has(error)) return UNKNOWN_WORKER_ERROR_MESSAGE

  seen.add(error)

  const nestedError = (error as { error?: unknown }).error
  if (nestedError) {
    const nestedMessage = getWorkerErrorMessage(nestedError, seen)
    if (nestedMessage !== UNKNOWN_WORKER_ERROR_MESSAGE) return nestedMessage
  }

  const message = (error as { message?: unknown }).message
  if (typeof message === 'string' && message.trim()) return message

  const cause = (error as { cause?: unknown }).cause
  if (cause) {
    const causeMessage = getWorkerErrorMessage(cause, seen)
    if (causeMessage !== UNKNOWN_WORKER_ERROR_MESSAGE) return causeMessage
  }

  try {
    return JSON.stringify(error) || UNKNOWN_WORKER_ERROR_MESSAGE
  } catch {
    return UNKNOWN_WORKER_ERROR_MESSAGE
  }
}

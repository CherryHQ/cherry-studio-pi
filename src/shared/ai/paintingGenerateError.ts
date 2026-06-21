/**
 * Presentation-free core of the painting-generation error type.
 *
 * Lives in `@shared` so it can be thrown from main-process image transports
 * AND constructed/normalized in the renderer. The i18n translation and
 * toast/modal presentation helpers stay renderer-side in
 * `@renderer/aiCore/errors/paintingGenerateError`, which re-exports this core.
 */

export type PaintingGenerateErrorCode =
  | 'NO_API_KEY'
  | 'PROVIDER_DISABLED'
  | 'PROMPT_REQUIRED'
  | 'TEXT_DESC_REQUIRED'
  | 'IMAGE_REQUIRED'
  | 'IMAGE_RETRY_REQUIRED'
  | 'EDIT_IMAGE_REQUIRED'
  | 'MISSING_REQUIRED_FIELDS'
  | 'IMAGE_HANDLE_REQUIRED'
  | 'REQ_ERROR_TOKEN'
  | 'REQ_ERROR_NO_BALANCE'
  | 'OPERATION_FAILED'
  | 'GENERATE_FAILED'
  | 'IMAGE_MIX_FAILED'
  | 'CUSTOM_SIZE_REQUIRED'
  | 'CUSTOM_SIZE_RANGE'
  | 'CUSTOM_SIZE_DIVISIBLE'
  | 'CUSTOM_SIZE_PIXELS'
  | 'REMOTE_ERROR'

export interface PaintingGenerateErrorOptions {
  message?: string
  presentation?: 'modal' | 'toast'
  severity?: 'error' | 'warning'
}

export class PaintingGenerateError extends Error {
  code: PaintingGenerateErrorCode
  presentation: 'modal' | 'toast'
  severity: 'error' | 'warning'

  constructor(code: PaintingGenerateErrorCode, options: PaintingGenerateErrorOptions = {}) {
    super(options.message || code)
    this.name = 'PaintingGenerateError'
    this.code = code
    this.presentation = options.presentation || 'modal'
    this.severity = options.severity || 'error'
  }
}

export function createPaintingGenerateError(
  code: PaintingGenerateErrorCode,
  options?: PaintingGenerateErrorOptions
): PaintingGenerateError {
  return new PaintingGenerateError(code, options)
}

function extractPaintingErrorMessage(error: unknown, seen = new WeakSet<object>()): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  if (!error || typeof error !== 'object') {
    return null
  }

  if (seen.has(error)) {
    return null
  }
  seen.add(error)

  const maybeMessage = (error as { message?: unknown }).message
  if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
    return maybeMessage.trim()
  }

  const maybeError = (error as { error?: unknown }).error
  const nestedErrorMessage = extractPaintingErrorMessage(maybeError, seen)
  if (nestedErrorMessage) {
    return nestedErrorMessage
  }

  const maybeCause = (error as { cause?: unknown }).cause
  return extractPaintingErrorMessage(maybeCause, seen)
}

export function normalizePaintingGenerateError(error: unknown): Error {
  if (error instanceof PaintingGenerateError) {
    return error
  }

  const message = extractPaintingErrorMessage(error)
  if (message) {
    return createPaintingGenerateError('REMOTE_ERROR', { message })
  }

  return createPaintingGenerateError('GENERATE_FAILED')
}

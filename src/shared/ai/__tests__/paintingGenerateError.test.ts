import { describe, expect, it } from 'vitest'

import { normalizePaintingGenerateError, PaintingGenerateError } from '../paintingGenerateError'

describe('normalizePaintingGenerateError', () => {
  it('preserves string remote error details', () => {
    const error = normalizePaintingGenerateError('rate limited')

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect(error).toMatchObject({
      code: 'REMOTE_ERROR',
      message: 'rate limited'
    })
  })

  it('preserves nested IPC remote error details', () => {
    const error = normalizePaintingGenerateError({ error: { message: 'Invalid response: 503 Service Unavailable' } })

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect(error).toMatchObject({
      code: 'REMOTE_ERROR',
      message: 'Invalid response: 503 Service Unavailable'
    })
  })

  it('falls back for empty or circular non-error values', () => {
    const circular: { cause?: unknown } = {}
    circular.cause = circular

    expect(normalizePaintingGenerateError(circular)).toMatchObject({
      code: 'GENERATE_FAILED',
      message: 'GENERATE_FAILED'
    })
    expect(normalizePaintingGenerateError(null)).toMatchObject({
      code: 'GENERATE_FAILED',
      message: 'GENERATE_FAILED'
    })
  })
})

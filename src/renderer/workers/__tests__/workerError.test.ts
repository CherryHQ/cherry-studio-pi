import { describe, expect, it } from 'vitest'

import { getWorkerErrorMessage } from '../workerError'

describe('getWorkerErrorMessage', () => {
  it('preserves nested bridged error details', () => {
    expect(getWorkerErrorMessage({ error: { message: 'worker bridge failed' } })).toBe('worker bridge failed')
  })

  it('preserves cause details when no direct message is present', () => {
    expect(getWorkerErrorMessage({ cause: { message: 'worker cause failed' } })).toBe('worker cause failed')
  })

  it('falls back safely for circular objects', () => {
    const circular: { cause?: unknown } = {}
    circular.cause = circular

    expect(getWorkerErrorMessage(circular)).toBe('Unknown error')
  })
})

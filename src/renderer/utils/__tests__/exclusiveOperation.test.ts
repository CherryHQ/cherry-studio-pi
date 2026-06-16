import { describe, expect, it, vi } from 'vitest'

import { runExclusiveOperation } from '../exclusiveOperation'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe('runExclusiveOperation', () => {
  it('ignores concurrent operations while one is pending', async () => {
    const operationRef = { current: false }
    const running = deferred<string>()
    const operation = vi.fn().mockReturnValueOnce(running.promise)

    const first = runExclusiveOperation(operationRef, operation)
    const second = runExclusiveOperation(operationRef, operation)

    expect(operation).toHaveBeenCalledTimes(1)
    await expect(second).resolves.toBeUndefined()

    running.resolve('done')
    await expect(first).resolves.toBe('done')
    expect(operationRef.current).toBe(false)
  })

  it('releases the operation lock when the operation fails', async () => {
    const operationRef = { current: false }
    const operation = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('recovered')

    await expect(runExclusiveOperation(operationRef, operation)).rejects.toThrow('boom')
    await expect(runExclusiveOperation(operationRef, operation)).resolves.toBe('recovered')
    expect(operation).toHaveBeenCalledTimes(2)
  })
})

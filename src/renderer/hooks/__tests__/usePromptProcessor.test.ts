import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePromptProcessor } from '../usePromptProcessor'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

const promptMocks = vi.hoisted(() => ({
  containsSupportedVariables: vi.fn(),
  replacePromptVariables: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/utils/prompt', () => ({
  containsSupportedVariables: promptMocks.containsSupportedVariables,
  replacePromptVariables: promptMocks.replacePromptVariables
}))

describe('usePromptProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    promptMocks.containsSupportedVariables.mockReturnValue(true)
  })

  it('ignores stale prompt variable replacement results', async () => {
    const slowFirst = deferred<string>()
    promptMocks.replacePromptVariables
      .mockReturnValueOnce(slowFirst.promise)
      .mockResolvedValueOnce('processed second prompt')

    const { result, rerender } = renderHook(({ prompt }) => usePromptProcessor({ prompt, modelName: 'test-model' }), {
      initialProps: { prompt: 'first {{date}} prompt' }
    })

    rerender({ prompt: 'second {{date}} prompt' })

    await waitFor(() => {
      expect(result.current).toBe('processed second prompt')
    })

    await act(async () => {
      slowFirst.resolve('processed first prompt')
      await slowFirst.promise
    })

    expect(result.current).toBe('processed second prompt')
    expect(promptMocks.replacePromptVariables).toHaveBeenNthCalledWith(1, 'first {{date}} prompt', 'test-model')
    expect(promptMocks.replacePromptVariables).toHaveBeenNthCalledWith(2, 'second {{date}} prompt', 'test-model')
  })
})

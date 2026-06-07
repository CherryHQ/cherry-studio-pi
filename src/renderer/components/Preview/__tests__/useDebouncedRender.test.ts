import { act, renderHook } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebouncedRender } from '../hooks/useDebouncedRender'

describe('useDebouncedRender', () => {
  const mockRenderFunction = vi.fn()

  beforeEach(() => {
    mockRenderFunction.mockReset()
    vi.useRealTimers()
  })

  it('should return expected interface', () => {
    const { result } = renderHook(() => useDebouncedRender('test content', mockRenderFunction))

    // Verify hook returns all expected properties
    expect(result.current).toHaveProperty('containerRef')
    expect(result.current).toHaveProperty('error')
    expect(result.current).toHaveProperty('isLoading')
    expect(result.current).toHaveProperty('triggerRender')
    expect(result.current).toHaveProperty('cancelRender')
    expect(result.current).toHaveProperty('clearError')
    expect(result.current).toHaveProperty('setLoading')

    // Verify types of returned values
    expect(result.current.containerRef).toEqual(expect.objectContaining({ current: null }))
    expect(result.current.error).toBe(null)
    expect(typeof result.current.isLoading).toBe('boolean')
    expect(typeof result.current.triggerRender).toBe('function')
    expect(typeof result.current.cancelRender).toBe('function')
    expect(typeof result.current.clearError).toBe('function')
    expect(typeof result.current.setLoading).toBe('function')
  })

  it('should handle different hook configurations', () => {
    const shouldRender = vi.fn(() => true)
    const options = {
      debounceDelay: 500,
      shouldRender
    }

    const { result } = renderHook(() => useDebouncedRender('content', mockRenderFunction, options))

    // Hook should still return the expected interface regardless of options
    expect(result.current).toHaveProperty('containerRef')
    expect(result.current).toHaveProperty('error')
    expect(result.current).toHaveProperty('isLoading')
    expect(result.current).toHaveProperty('triggerRender')
    expect(result.current).toHaveProperty('cancelRender')
    expect(result.current).toHaveProperty('clearError')
    expect(result.current).toHaveProperty('setLoading')
  })

  it('should keep stale render failures from overwriting newer successful renders', async () => {
    vi.useFakeTimers()

    let rejectFirstRender!: (error: Error) => void
    const renderFunction = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectFirstRender = reject
          })
      )
      .mockResolvedValueOnce(undefined)

    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedRender(value, renderFunction, { debounceDelay: 0 }),
      {
        initialProps: { value: 'first' }
      }
    )

    const container = document.createElement('div')
    ;(result.current.containerRef as MutableRefObject<HTMLDivElement | null>).current = container

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(renderFunction).toHaveBeenCalledWith('first', container)

    rerender({ value: 'second' })

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(renderFunction).toHaveBeenCalledWith('second', container)

    await act(async () => {
      rejectFirstRender(new Error('stale render failed'))
      await Promise.resolve()
    })

    expect(result.current.error).toBe(null)
    expect(result.current.isLoading).toBe(false)
  })
})

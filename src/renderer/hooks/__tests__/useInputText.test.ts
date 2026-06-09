import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useInputText } from '../useInputText'

describe('useInputText', () => {
  it('composes consecutive functional updates against the latest text', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useInputText({ initialValue: '', onChange }))

    act(() => {
      result.current.setText((prev) => prev + '你')
      result.current.setText((prev) => prev + '好')
    })

    expect(result.current.text).toBe('你好')
    expect(onChange).toHaveBeenNthCalledWith(1, '你')
    expect(onChange).toHaveBeenNthCalledWith(2, '你好')
  })
})

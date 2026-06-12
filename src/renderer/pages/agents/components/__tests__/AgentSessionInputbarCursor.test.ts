import { describe, expect, it, vi } from 'vitest'

import { restoreTextareaCursor } from '../AgentSessionInputbarCursor'

describe('restoreTextareaCursor', () => {
  it('restores focus and selection for a mounted textarea', () => {
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    const setSelectionRange = vi.spyOn(textarea, 'setSelectionRange')

    try {
      expect(restoreTextareaCursor(textarea, 3)).toBe(true)
      expect(document.activeElement).toBe(textarea)
      expect(setSelectionRange).toHaveBeenCalledWith(3, 3)
    } finally {
      textarea.remove()
      setSelectionRange.mockRestore()
    }
  })

  it('skips detached textarea nodes from stale async callbacks', () => {
    const textarea = document.createElement('textarea')
    const focus = vi.spyOn(textarea, 'focus')
    const setSelectionRange = vi.spyOn(textarea, 'setSelectionRange')

    expect(restoreTextareaCursor(textarea, 3)).toBe(false)
    expect(focus).not.toHaveBeenCalled()
    expect(setSelectionRange).not.toHaveBeenCalled()

    focus.mockRestore()
    setSelectionRange.mockRestore()
  })
})

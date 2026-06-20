import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LinkEditor from '../LinkEditor'

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

function renderLinkEditor(overrides: Partial<React.ComponentProps<typeof LinkEditor>> = {}) {
  return render(
    <LinkEditor
      visible
      position={{ x: 10, y: 20 }}
      link={{ href: 'https://example.com', text: 'Example' }}
      onSave={vi.fn()}
      onRemove={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />
  )
}

describe('LinkEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('ignores mousedown events whose target is not an element', () => {
    const onCancel = vi.fn()
    renderLinkEditor({ onCancel })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(() => {
      document.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true
        })
      )
    }).not.toThrow()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('still closes when clicking an outside element', () => {
    const onCancel = vi.fn()
    renderLinkEditor({ onCancel })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    fireEvent.mouseDown(document.body)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

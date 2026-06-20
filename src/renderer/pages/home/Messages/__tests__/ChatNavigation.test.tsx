// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatNavigation from '../ChatNavigation'

vi.mock('@ant-design/icons', () => ({
  ArrowDownOutlined: () => <span data-testid="arrow-down" />,
  ArrowUpOutlined: () => <span data-testid="arrow-up" />,
  CloseOutlined: () => <span data-testid="close" />,
  VerticalAlignBottomOutlined: () => <span data-testid="bottom" />,
  VerticalAlignTopOutlined: () => <span data-testid="top" />
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'topic.position') return ['left']
    if (key === 'topic.tab.show') return [false]
    return [undefined]
  }
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn(),
    clearTimeoutTimer: vi.fn()
  })
}))

vi.mock('@renderer/utils/dom', () => ({
  scrollIntoView: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('ChatNavigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="messages-container"><div id="chat-container"></div></div>'
  })

  it('handles global mousemove events whose target is window', () => {
    render(<ChatNavigation containerId="chat-container" />)

    const event = new MouseEvent('mousemove', {
      bubbles: true,
      clientX: window.innerWidth - 30,
      clientY: window.innerHeight / 2
    })

    expect(() => {
      act(() => {
        window.dispatchEvent(event)
      })
    }).not.toThrow()
  })
})

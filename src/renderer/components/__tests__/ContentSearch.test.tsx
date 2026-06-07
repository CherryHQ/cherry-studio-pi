import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContentSearch, type ContentSearchRef } from '../ContentSearch'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    ...props
  }: React.ComponentProps<'button'> & {
    size?: string
    variant?: string
  }) => {
    const buttonProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => key !== 'size' && key !== 'variant')
    ) as React.ComponentProps<'button'>

    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  },
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/pages/home/Messages/NarrowLayout', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const originalRAF = window.requestAnimationFrame
const originalCSS = globalThis.CSS
const originalHighlight = globalThis.Highlight
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

beforeAll(() => {
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    },
    configurable: true
  })
  Object.defineProperty(globalThis, 'CSS', {
    value: {
      ...originalCSS,
      highlights: {
        clear: vi.fn(),
        set: vi.fn()
      }
    },
    configurable: true
  })
  vi.stubGlobal(
    'Highlight',
    vi.fn().mockImplementation((...ranges: Range[]) => ({ ranges }))
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterAll(() => {
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: originalRAF,
    configurable: true
  })
  Object.defineProperty(globalThis, 'CSS', {
    value: originalCSS,
    configurable: true
  })
  vi.stubGlobal('Highlight', originalHighlight)
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView
})

describe('ContentSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears stale result counts when disabled and reopened without a query', async () => {
    const target = document.createElement('div')
    target.textContent = 'hello world'
    document.body.append(target)
    let searchRef: ContentSearchRef | null = null

    render(
      <ContentSearch
        ref={(instance) => {
          searchRef = instance
        }}
        searchTarget={target}
        filter={() => NodeFilter.FILTER_ACCEPT}
      />
    )

    act(() => {
      searchRef?.enable('hello')
    })

    await waitFor(() => {
      expect(screen.getByText('/').parentElement).toHaveTextContent('1/1')
    })

    act(() => {
      searchRef?.disable()
      searchRef?.enable()
    })

    await waitFor(() => {
      expect(screen.getByText('0/0')).toBeInTheDocument()
    })
    expect(screen.queryByText('/')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('chat.assistant.search.placeholder')).toHaveValue('')

    target.remove()
  })
})

import type { Citation } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CitationsList from '../CitationsList'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/Icons/FallbackFavicon', () => ({
  __esModule: true,
  default: () => <span data-testid="favicon" />
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  __esModule: true,
  default: ({ children, className }: any) => <div className={className}>{children}</div>
}))

vi.mock('@renderer/components/SelectionContextMenu', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>
}))

vi.mock('@renderer/utils/fetch', () => ({
  fetchWebContent: vi.fn(),
  fetchXOEmbed: vi.fn(),
  isXPostUrl: vi.fn(() => false)
}))

vi.mock('antd', () => ({
  Popover: ({ children, content, title }: any) => (
    <div>
      {children}
      <div data-testid="popover">
        {title}
        {content}
      </div>
    </div>
  ),
  Skeleton: () => <div data-testid="skeleton" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => (values?.count ? `${key}:${values.count}` : key)
  })
}))

describe('CitationsList', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn())
    vi.stubGlobal('api', {
      file: {
        openPath: vi.fn()
      }
    })
  })

  it('renders web citations without urls as non-links', () => {
    const citations: Citation[] = [
      {
        number: 2,
        url: '',
        title: 'Data Structures for Statistical Computing in Python',
        content: 'Reference text',
        showFavicon: true,
        type: 'websearch'
      }
    ]

    render(<CitationsList citations={citations} />)

    const title = screen.getByText('Data Structures for Statistical Computing in Python')
    expect(title).toBeInTheDocument()
    expect(title.closest('a')).toBeNull()
  })

  it('renders malformed web citation urls without crashing', () => {
    const citations: Citation[] = [
      {
        number: 1,
        url: 'not a valid url',
        title: 'Recovered citation',
        content: 'Reference text',
        showFavicon: true,
        type: 'websearch'
      }
    ]

    render(<CitationsList citations={citations} />)

    expect(screen.getByText('Recovered citation')).toBeInTheDocument()
  })

  it('opens http citation urls in the browser', () => {
    const citations: Citation[] = [
      {
        number: 1,
        url: 'https://example.com/source',
        title: 'External citation',
        content: 'Reference text',
        showFavicon: true,
        type: 'websearch'
      }
    ]

    render(<CitationsList citations={citations} />)
    fireEvent.click(screen.getByRole('link', { name: 'External citation' }))

    expect(window.open).toHaveBeenCalledWith('https://example.com/source', '_blank', 'noopener,noreferrer')
    expect(window.api.file.openPath).not.toHaveBeenCalled()
  })

  it('does not open unsupported http-like schemes in the browser', () => {
    const citations: Citation[] = [
      {
        number: 1,
        url: 'httpx://example.com/source',
        title: 'Unsupported citation',
        content: 'Reference text',
        showFavicon: true,
        type: 'websearch'
      }
    ]

    render(<CitationsList citations={citations} />)
    fireEvent.click(screen.getByRole('link', { name: 'Unsupported citation' }))

    expect(window.open).not.toHaveBeenCalled()
    expect(window.api.file.openPath).toHaveBeenCalledWith('httpx://example.com/source')
  })
})

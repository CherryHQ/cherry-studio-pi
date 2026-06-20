import type { Citation } from '@renderer/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CitationsList from '../CitationsList'

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
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn()
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

  it('does not treat malformed web citation urls as local file paths', () => {
    const citations: Citation[] = [
      {
        number: 1,
        url: '/Users/cherry/Documents/not-a-web-citation.md',
        title: 'Malformed web citation',
        content: 'Reference text',
        showFavicon: true,
        type: 'websearch'
      }
    ]

    render(<CitationsList citations={citations} />)
    fireEvent.click(screen.getByRole('link', { name: 'Malformed web citation' }))

    expect(window.open).not.toHaveBeenCalled()
    expect(window.api.file.openPath).not.toHaveBeenCalled()
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
    expect(window.api.file.openPath).not.toHaveBeenCalled()
  })

  it('opens non-url citation paths with the local file handler', () => {
    const citations: Citation[] = [
      {
        number: 1,
        url: '/Users/cherry/Documents/source.md',
        title: 'Local citation',
        content: 'Reference text',
        showFavicon: true,
        type: 'knowledge'
      }
    ]

    render(<CitationsList citations={citations} />)
    fireEvent.click(screen.getByRole('link', { name: 'Local citation' }))

    expect(window.open).not.toHaveBeenCalled()
    expect(window.api.file.openPath).toHaveBeenCalledWith('/Users/cherry/Documents/source.md')
  })

  it('does not show copy feedback after the citation copy button unmounts', async () => {
    const runningCopy = deferred<void>()
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(runningCopy.promise)
    const citations: Citation[] = [
      {
        number: 1,
        url: '/Users/cherry/Documents/source.md',
        title: 'Local citation',
        content: 'Reference text',
        showFavicon: true,
        type: 'knowledge'
      }
    ]
    const { unmount } = render(<CitationsList citations={citations} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))
    unmount()

    await act(async () => {
      runningCopy.resolve()
      await runningCopy.promise
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorDetailContent } from '..'

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  highlightCode: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    highlightCode: mocks.highlightCode
  })
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/components/Popups/GeneralPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('../AiDiagnosisSection', () => ({
  default: () => null
}))

describe('ErrorDetailContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.highlightCode.mockImplementation(async (code: string) => `<pre><code>${code}</code></pre>`)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mocks.clipboardWriteText
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError,
        success: mocks.toastSuccess
      }
    })
  })

  it('renders non-JSON AI SDK error causes as escaped text', async () => {
    const cause = '<img src="x" onerror="alert(1)"><script>alert(2)</script>'
    const { container } = render(
      <ErrorDetailContent
        error={{
          name: 'AI_TypeValidationError',
          message: 'Invalid response',
          stack: null,
          cause,
          value: {}
        }}
      />
    )

    await waitFor(() => expect(container.querySelector('.markdown')?.textContent).toContain(cause))
    expect(container.querySelector('.markdown script')).toBeNull()
    expect(container.querySelector('.markdown img')).toBeNull()
  })

  it('sanitizes highlighted JSON cause HTML before rendering', async () => {
    mocks.highlightCode.mockResolvedValueOnce('<pre><code>{"ok":true}</code></pre><script>alert(1)</script>')
    const { container } = render(
      <ErrorDetailContent
        error={{
          name: 'AI_TypeValidationError',
          message: 'Invalid response',
          stack: null,
          cause: '{"ok":true}',
          value: {}
        }}
      />
    )

    await waitFor(() => expect(container.querySelector('.markdown pre')).not.toBeNull())
    expect(container.querySelector('.markdown script')).toBeNull()
    expect(container.querySelector('.markdown')?.textContent).toContain('{"ok":true}')
  })

  it('shows copy failure feedback when copying error details fails', async () => {
    mocks.clipboardWriteText.mockRejectedValueOnce(new Error('clipboard locked'))

    render(
      <ErrorDetailContent
        error={{
          name: 'Error',
          message: 'Something failed',
          stack: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /common.copy/ }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('common.copy_failed: clipboard locked')
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('ignores copy failure feedback after unmount', async () => {
    const clipboardOperation = deferred<void>()
    mocks.clipboardWriteText.mockReturnValueOnce(clipboardOperation.promise)

    const { unmount } = render(
      <ErrorDetailContent
        error={{
          name: 'Error',
          message: 'Something failed',
          stack: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /common.copy/ }))

    await waitFor(() => expect(mocks.clipboardWriteText).toHaveBeenCalled())
    unmount()

    await act(async () => {
      clipboardOperation.reject(new Error('clipboard locked after unmount'))
      await clipboardOperation.promise.catch(() => undefined)
    })

    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('ignores copy success feedback after unmount', async () => {
    const clipboardOperation = deferred<void>()
    mocks.clipboardWriteText.mockReturnValueOnce(clipboardOperation.promise)

    const { unmount } = render(
      <ErrorDetailContent
        error={{
          name: 'Error',
          message: 'Something failed',
          stack: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /common.copy/ }))

    await waitFor(() => expect(mocks.clipboardWriteText).toHaveBeenCalled())
    unmount()

    await act(async () => {
      clipboardOperation.resolve()
      await clipboardOperation.promise
    })

    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})

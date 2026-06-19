import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FileProcessingApiKeyList } from '../components/FileProcessingApiKeyList'

const setApiKeysMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  EditIcon: ({ size }: { size?: number }) => <span data-size={size}>edit</span>
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ asChild, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
    if (asChild) {
      return <>{children}</>
    }

    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Dialog: ({ children, open }: React.HTMLAttributes<HTMLDivElement> & { open?: boolean }) =>
    open === false ? null : <>{children}</>,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div role="dialog" {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement> & { content?: React.ReactNode; delay?: number }) => (
    <>{children}</>
  )
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('FileProcessingApiKeyList', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    setApiKeysMock.mockReset()
    setApiKeysMock.mockResolvedValue(undefined)
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: {
        confirm: vi.fn().mockResolvedValue(true)
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  })

  it('adds API keys through the file processing list', async () => {
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={[]} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: /common.add/ }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: ' key-1 ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(setApiKeysMock).toHaveBeenCalledWith('mistral', ['key-1'])
    })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('settings.provider.api.key.new_key.placeholder')).not.toBeInTheDocument()
    })
  })

  it('ignores duplicate save clicks while a key update is still in flight', async () => {
    const runningUpdate = deferred<void>()
    setApiKeysMock.mockReturnValueOnce(runningUpdate.promise)
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={[]} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: /common.add/ }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'key-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    expect(setApiKeysMock).toHaveBeenCalledTimes(1)

    runningUpdate.resolve()
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('settings.provider.api.key.new_key.placeholder')).not.toBeInTheDocument()
    })
  })

  it('rejects duplicate API keys', async () => {
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={['key-1']} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: /common.add/ }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'key-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    expect(setApiKeysMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(window.toast.warning).toHaveBeenCalledWith('settings.provider.api.key.error.duplicate')
    })
  })

  it('removes the last API key', async () => {
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={['key-1']} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => {
      expect(setApiKeysMock).toHaveBeenCalledWith('mistral', [])
    })
  })

  it('ignores duplicate delete clicks while confirmation is still open', async () => {
    const runningConfirmation = deferred<boolean>()
    const confirm = vi.fn().mockReturnValueOnce(runningConfirmation.promise)
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: { confirm }
    })
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={['key-1']} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    expect(confirm).toHaveBeenCalledTimes(1)

    runningConfirmation.resolve(false)
    await waitFor(() => {
      expect(setApiKeysMock).not.toHaveBeenCalled()
    })
  })

  it('keeps editing when API key persistence fails', async () => {
    const error = new Error('persist failed')
    setApiKeysMock.mockRejectedValueOnce(error)
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={[]} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: /common.add/ }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'key-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('settings.tool.file_processing.errors.save_failed')
    })
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to save file processing API key', error)
    expect(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder')).toHaveValue('key-1')
  })

  it('ignores save failures after the API key row unmounts', async () => {
    const runningUpdate = deferred<void>()
    setApiKeysMock.mockReturnValueOnce(runningUpdate.promise)
    const { unmount } = render(
      <FileProcessingApiKeyList processorId="mistral" apiKeys={[]} onSetApiKeys={setApiKeysMock} />
    )

    fireEvent.click(screen.getByRole('button', { name: /common.add/ }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'key-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(setApiKeysMock).toHaveBeenCalledWith('mistral', ['key-1']))
    unmount()

    await act(async () => {
      runningUpdate.reject(new Error('persist failed after unmount'))
      await runningUpdate.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('reports remove failures without treating the deletion as successful', async () => {
    const error = new Error('persist failed')
    setApiKeysMock.mockRejectedValueOnce(error)
    render(<FileProcessingApiKeyList processorId="mistral" apiKeys={['key-1']} onSetApiKeys={setApiKeysMock} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('settings.tool.file_processing.errors.save_failed')
    })
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to remove file processing API key', error)
    expect(screen.getByText('key-1')).toBeInTheDocument()
  })

  it('does not remove a key when delete confirmation resolves after unmount', async () => {
    const runningConfirmation = deferred<boolean>()
    const confirm = vi.fn().mockReturnValueOnce(runningConfirmation.promise)
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: { confirm }
    })
    const { unmount } = render(
      <FileProcessingApiKeyList processorId="mistral" apiKeys={['key-1']} onSetApiKeys={setApiKeysMock} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    unmount()

    await act(async () => {
      runningConfirmation.resolve(true)
      await runningConfirmation.promise
    })

    expect(setApiKeysMock).not.toHaveBeenCalled()
  })

  it('updates saved key rows from apiKeys props', () => {
    const { rerender } = render(
      <FileProcessingApiKeyList processorId="mistral" apiKeys={['key-1']} onSetApiKeys={setApiKeysMock} />
    )

    expect(screen.getByText('key-1')).toBeInTheDocument()

    rerender(<FileProcessingApiKeyList processorId="mistral" apiKeys={['key-2']} onSetApiKeys={setApiKeysMock} />)

    expect(screen.queryByText('key-1')).not.toBeInTheDocument()
    expect(screen.getByText('key-2')).toBeInTheDocument()
  })
})

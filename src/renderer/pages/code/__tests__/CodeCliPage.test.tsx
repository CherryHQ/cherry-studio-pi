import '@testing-library/jest-dom/vitest'

import { codeCLI, terminalApps } from '@shared/config/constant'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  isBunInstalled: true,
  selectedCliTool: 'github-copilot-cli',
  canLaunch: true,
  codeCliRun: vi.fn(),
  setCliTool: vi.fn(),
  setModel: vi.fn(),
  setTerminal: vi.fn(),
  setEnvVars: vi.fn(),
  setCurrentDir: vi.fn(),
  removeDir: vi.fn(),
  selectFolder: vi.fn(),
  setIsBunInstalled: vi.fn(),
  setTimeoutTimer: vi.fn()
}))

import CodeCliPage from '../CodeCliPage'

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  return {
    Button: ({ children, loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) =>
      React.createElement('button', { type: 'button', ...props, disabled: props.disabled || loading }, children),
    Checkbox: ({
      className,
      id,
      onCheckedChange
    }: {
      className?: string
      id?: string
      onCheckedChange?: (v: boolean) => void
    }) =>
      React.createElement('button', {
        id,
        type: 'button',
        role: 'checkbox',
        className,
        onClick: () => onCheckedChange?.(true)
      }),
    Label: ({ children, htmlFor, className }: { children: React.ReactNode; htmlFor?: string; className?: string }) =>
      React.createElement('label', { htmlFor, className }, children),
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? React.createElement('div', { role: 'dialog' }, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogClose: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SelectDropdown: () => React.createElement('div', null),
    Textarea: {
      Input: ({ value, onValueChange }: { value?: string; onValueChange?: (value: string) => void }) =>
        React.createElement('textarea', {
          value,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onValueChange?.(event.currentTarget.value)
        })
    }
  }
})

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: false,
  isWin: false
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: () => [testState.isBunInstalled, testState.setIsBunInstalled]
}))

vi.mock('@renderer/hooks/useCodeCli', () => ({
  useCodeCli: () => ({
    selectedCliTool: testState.selectedCliTool as codeCLI,
    selectedModel: null,
    selectedTerminal: terminalApps.systemDefault,
    environmentVariables: '',
    directories: [],
    currentDirectory: '',
    canLaunch: testState.canLaunch,
    setCliTool: testState.setCliTool,
    setModel: testState.setModel,
    setTerminal: testState.setTerminal,
    setEnvVars: testState.setEnvVars,
    setCurrentDir: testState.setCurrentDir,
    removeDir: testState.removeDir,
    selectFolder: testState.selectFolder
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] }),
  getProviderDisplayName: (provider: { name?: string; id?: string }) => provider?.name ?? provider?.id ?? ''
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [] })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: testState.setTimeoutTimer })
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@shared/config/providers', () => ({
  CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS: [],
  isSiliconAnthropicCompatibleModel: () => false
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/CodeToolGallery', () => ({
  CodeToolGallery: ({
    tools,
    handleSelectTool
  }: {
    tools: Array<{ value: codeCLI; label: string }>
    handleSelectTool: (value: codeCLI) => void
  }) => (
    <button type="button" onClick={() => handleSelectTool(tools[0].value)}>
      open tool
    </button>
  )
}))

vi.mock('../components/FieldLabel', () => ({
  FieldLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

beforeEach(() => {
  vi.clearAllMocks()
  testState.isBunInstalled = true
  testState.selectedCliTool = codeCLI.githubCopilotCli
  testState.canLaunch = true
  testState.codeCliRun.mockResolvedValue({ success: true })
  testState.setCliTool.mockResolvedValue(undefined)
  testState.setModel.mockResolvedValue(undefined)
  testState.setTerminal.mockResolvedValue(undefined)
  testState.setEnvVars.mockResolvedValue(undefined)
  testState.setCurrentDir.mockResolvedValue(undefined)
  testState.removeDir.mockResolvedValue(undefined)
  testState.selectFolder.mockResolvedValue(undefined)
  testState.setIsBunInstalled.mockReset()
  Object.assign(window, {
    api: {
      isBinaryExist: vi.fn().mockResolvedValue(true),
      codeCli: {
        getAvailableTerminals: vi.fn().mockResolvedValue([]),
        run: testState.codeCliRun
      }
    },
    toast: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    }
  })
})

async function openCodeToolDialog() {
  render(<CodeCliPage />)
  fireEvent.click(screen.getByRole('button', { name: 'open tool' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
}

describe('CodeCliPage', () => {
  it('constrains the page height so the gallery can scroll', () => {
    const { container } = render(<CodeCliPage />)

    expect(container.firstElementChild).toHaveClass('h-full', 'min-h-0', 'overflow-hidden')
  })

  it('keeps the auto-update checkbox neutral instead of primary themed', async () => {
    await openCodeToolDialog()

    const checkbox = await screen.findByRole('checkbox')

    // Behavioral guard: page must not theme the auto-update checkbox with the global primary token.
    expect(checkbox.className).not.toMatch(/primary/)
    expect(screen.getByText('code.auto_update_to_latest')).toHaveClass('font-normal')
  })

  it('shows a save failure when switching CLI tools fails', async () => {
    testState.setCliTool.mockRejectedValueOnce(new Error('settings unavailable'))

    render(<CodeCliPage />)
    fireEvent.click(screen.getByRole('button', { name: 'open tool' }))

    await waitFor(() => expect(testState.setCliTool).toHaveBeenCalledWith(codeCLI.claudeCode))
    await waitFor(() => expect(window.toast.error).toHaveBeenCalledWith('common.save_failed: settings unavailable'))
  })

  it('ignores stale CLI tool save failures after unmount', async () => {
    const saveOperation = deferred<void>()
    testState.setCliTool.mockReturnValueOnce(saveOperation.promise)

    const { unmount } = render(<CodeCliPage />)
    fireEvent.click(screen.getByRole('button', { name: 'open tool' }))

    await waitFor(() => expect(testState.setCliTool).toHaveBeenCalledWith(codeCLI.claudeCode))
    unmount()

    await act(async () => {
      saveOperation.reject(new Error('settings unavailable after unmount'))
      await saveOperation.promise.catch(() => undefined)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('ignores delayed bun installation checks after unmount', async () => {
    const checkOperation = deferred<boolean>()
    Object.assign(window, {
      api: {
        ...window.api,
        isBinaryExist: vi.fn().mockReturnValueOnce(checkOperation.promise)
      }
    })

    const { unmount } = render(<CodeCliPage />)
    expect(window.api.isBinaryExist).toHaveBeenCalledWith('bun')

    unmount()

    await act(async () => {
      checkOperation.resolve(false)
      await checkOperation.promise
    })

    expect(testState.setIsBunInstalled).not.toHaveBeenCalled()
  })

  it('disables launch when the tool cannot launch', async () => {
    testState.canLaunch = false

    await openCodeToolDialog()

    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeDisabled()
  })

  it('disables launch when bun is not installed', async () => {
    testState.isBunInstalled = false

    await openCodeToolDialog()

    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeDisabled()
  })

  it('shows launching state and prevents duplicate launch submissions', async () => {
    let resolveRun!: (value: { success: boolean }) => void
    testState.codeCliRun.mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        resolveRun = resolve
      })
    )

    await openCodeToolDialog()

    const launchButton = screen.getByRole('button', { name: 'code.launch.label' })
    fireEvent.click(launchButton)

    const launchingButton = await screen.findByRole('button', { name: 'code.launching' })
    expect(launchingButton).toBeDisabled()
    fireEvent.click(launchingButton)
    expect(testState.codeCliRun).toHaveBeenCalledTimes(1)

    resolveRun({ success: true })
    await waitFor(() => expect(window.toast.success).toHaveBeenCalledWith('code.launch.success'))
  })

  it('shows launched state after a successful launch and schedules reset', async () => {
    await openCodeToolDialog()

    fireEvent.click(screen.getByRole('button', { name: 'code.launch.label' }))

    expect(await screen.findByRole('button', { name: /code.launch.launched/ })).toBeEnabled()
    expect(testState.setTimeoutTimer).toHaveBeenCalledWith('launchSuccess', expect.any(Function), 2500)
  })

  it('ignores a delayed launch result after unmount', async () => {
    const runOperation = deferred<{ success: boolean }>()
    testState.codeCliRun.mockReturnValueOnce(runOperation.promise)

    const { unmount } = render(<CodeCliPage />)
    fireEvent.click(screen.getByRole('button', { name: 'open tool' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'code.launch.label' }))
    await waitFor(() => expect(testState.codeCliRun).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      runOperation.resolve({ success: true })
      await runOperation.promise
    })

    expect(window.toast.success).not.toHaveBeenCalled()
    expect(testState.setTimeoutTimer).not.toHaveBeenCalledWith('launchSuccess', expect.any(Function), 2500)
  })

  it('launches successfully when toast is unavailable', async () => {
    Object.assign(window, { toast: undefined })

    await openCodeToolDialog()

    fireEvent.click(screen.getByRole('button', { name: 'code.launch.label' }))

    expect(await screen.findByRole('button', { name: /code.launch.launched/ })).toBeEnabled()
    expect(testState.codeCliRun).toHaveBeenCalledTimes(1)
  })

  it('returns to idle and shows an error when launch fails', async () => {
    testState.codeCliRun.mockResolvedValue({ success: false, message: 'launch failed' })

    await openCodeToolDialog()

    fireEvent.click(screen.getByRole('button', { name: 'code.launch.label' }))

    await waitFor(() => expect(window.toast.error).toHaveBeenCalledWith('launch failed'))
    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeEnabled()
  })

  it('preserves nested launch error details when the CLI bridge rejects', async () => {
    testState.codeCliRun.mockRejectedValueOnce({
      error: { message: 'terminal executable not found' }
    })

    await openCodeToolDialog()

    fireEvent.click(screen.getByRole('button', { name: 'code.launch.label' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('code.launch.error: terminal executable not found')
    })
    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeEnabled()
  })
})

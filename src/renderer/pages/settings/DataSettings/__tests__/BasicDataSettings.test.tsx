import { render, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BasicDataSettings from '../BasicDataSettings'

const mocks = vi.hoisted(() => ({
  allowQuit: vi.fn(),
  copy: vi.fn(),
  flushAppData: vi.fn(),
  getAppInfo: vi.fn(),
  getCacheSize: vi.fn(),
  getDataPathFromArgs: vi.fn(),
  modalConfirm: vi.fn(),
  modalInfo: vi.fn(),
  preventQuit: vi.fn(),
  relaunch: vi.fn(),
  setAppDataPath: vi.fn(),
  setSkipBackupFile: vi.fn(),
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn()
  }
}))

const appInfo = {
  appDataPath: '/old-data',
  installPath: '/Applications/Cherry Studio Pi.app',
  logsPath: '/logs/app.log'
}

vi.mock('@ant-design/icons', () => ({
  LoadingOutlined: ({ style }: { style?: React.CSSProperties }) => <span style={style} />,
  WifiOutlined: ({ size }: { size?: number }) => <span data-size={size} />
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    onClick,
    variant: _variant
  }: React.PropsWithChildren<{
    onClick?: () => void
    variant?: string
  }>) => {
    void _variant

    return (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    )
  },
  RowFlex: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
  Switch: ({
    checked,
    defaultChecked,
    onCheckedChange
  }: {
    checked?: boolean
    defaultChecked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked ?? defaultChecked}
      onClick={() => onCheckedChange?.(!(checked ?? defaultChecked))}>
      switch
    </button>
  ),
  Tooltip: ({ children }: React.PropsWithChildren<{ title?: string }>) => <>{children}</>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false, mocks.setSkipBackupFile]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/Popups/BackupPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/components/Popups/LanTransferPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/components/Popups/RestorePopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_key: string, handler: TimerHandler) => {
      if (typeof handler === 'function') {
        handler()
      }

      return vi.fn()
    }
  })
}))

vi.mock('@renderer/services/BackupService', () => ({
  reset: vi.fn()
}))

vi.mock('../..', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: React.PropsWithChildren<{ theme?: string }>) => <section>{children}</section>,
  SettingHelpText: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
  SettingRow: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SettingRowTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SettingTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

function installWindowApi() {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      application: {
        allowQuit: mocks.allowQuit,
        preventQuit: mocks.preventQuit,
        relaunch: mocks.relaunch
      },
      copy: mocks.copy,
      flushAppData: mocks.flushAppData,
      getAppInfo: mocks.getAppInfo,
      getCacheSize: mocks.getCacheSize,
      getDataPathFromArgs: mocks.getDataPathFromArgs,
      hasWritePermission: vi.fn().mockResolvedValue(true),
      isNotEmptyDir: vi.fn().mockResolvedValue(false),
      isPathInside: vi.fn().mockResolvedValue(false),
      openPath: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(null),
      setAppDataPath: mocks.setAppDataPath
    }
  })

  Object.defineProperty(window, 'modal', {
    configurable: true,
    value: {
      confirm: mocks.modalConfirm,
      info: mocks.modalInfo
    }
  })

  Object.defineProperty(window, 'toast', {
    configurable: true,
    value: mocks.toast
  })
}

describe('BasicDataSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installWindowApi()

    mocks.allowQuit.mockResolvedValue(undefined)
    mocks.copy.mockResolvedValue({ success: true })
    mocks.flushAppData.mockResolvedValue(undefined)
    mocks.getAppInfo.mockResolvedValue(appInfo)
    mocks.getCacheSize.mockResolvedValue('12.3')
    mocks.getDataPathFromArgs.mockResolvedValue(null)
    mocks.modalInfo.mockReturnValue({ destroy: vi.fn(), update: vi.fn() })
    mocks.preventQuit.mockResolvedValue('hold-1')
    mocks.relaunch.mockResolvedValue(undefined)
    mocks.setAppDataPath.mockResolvedValue(undefined)
  })

  it('cleans up the migration progress modal when the quit hold cannot be acquired', async () => {
    const progressModal = { destroy: vi.fn(), update: vi.fn() }
    mocks.getDataPathFromArgs.mockResolvedValue('/new-data')
    mocks.modalInfo.mockReturnValue(progressModal)
    mocks.preventQuit.mockRejectedValue(new Error('hold failed'))

    render(<BasicDataSettings />)

    await waitFor(() => expect(mocks.modalInfo).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(progressModal.destroy).toHaveBeenCalledTimes(1))

    expect(mocks.copy).not.toHaveBeenCalled()
    expect(mocks.allowQuit).not.toHaveBeenCalled()
    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('hold failed')
      })
    )
  })

  it('releases the migration quit hold before relaunching after a successful migration', async () => {
    const progressModal = { destroy: vi.fn(), update: vi.fn() }
    mocks.getDataPathFromArgs.mockResolvedValue('/new-data')
    mocks.modalInfo.mockReturnValue(progressModal)

    render(<BasicDataSettings />)

    await waitFor(() => expect(mocks.relaunch).toHaveBeenCalledTimes(1))

    expect(mocks.copy).toHaveBeenCalledWith('/old-data', '/new-data')
    expect(mocks.setAppDataPath).toHaveBeenCalledWith('/new-data')
    expect(mocks.allowQuit).toHaveBeenCalledWith('hold-1')
    expect(mocks.allowQuit.mock.invocationCallOrder[0]).toBeLessThan(mocks.relaunch.mock.invocationCallOrder[0])
    expect(mocks.relaunch).toHaveBeenCalledWith({ args: ['--user-data-dir=/new-data'] })
    expect(progressModal.destroy).toHaveBeenCalled()
  })

  it('does not mark the migration progress as successful when copying data fails', async () => {
    const progressModal = { destroy: vi.fn(), update: vi.fn() }
    mocks.getDataPathFromArgs.mockResolvedValue('/new-data')
    mocks.modalInfo.mockReturnValue(progressModal)
    mocks.copy.mockResolvedValue({ success: false, error: 'copy failed' })

    render(<BasicDataSettings />)

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('copy failed')
        })
      )
    )

    expect(progressModal.update).not.toHaveBeenCalled()
    expect(progressModal.destroy).toHaveBeenCalled()
  })
})

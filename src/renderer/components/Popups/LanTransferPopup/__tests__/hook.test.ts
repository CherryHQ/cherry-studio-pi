import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLanTransfer } from '../hook'

const mocks = vi.hoisted(() => ({
  getBackupData: vi.fn()
}))

vi.mock('@renderer/services/BackupService', () => ({
  getBackupData: mocks.getBackupData
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('useLanTransfer', () => {
  const connectMock = vi.fn()
  const sendFileMock = vi.fn()
  const startScanMock = vi.fn()
  const stopScanMock = vi.fn()
  const createLanTransferBackupMock = vi.fn()
  const deleteLanTransferBackupMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBackupData.mockResolvedValue({ settings: { version: 1 } })
    connectMock.mockResolvedValue({ type: 'handshake_ack', accepted: true })
    sendFileMock.mockResolvedValue({ success: true })
    startScanMock.mockResolvedValue({
      services: [
        {
          id: 'peer-1',
          name: 'Phone',
          addresses: ['192.168.1.20'],
          updatedAt: Date.now()
        }
      ],
      isScanning: true,
      lastUpdatedAt: Date.now()
    })
    stopScanMock.mockResolvedValue(undefined)
    createLanTransferBackupMock.mockResolvedValue('/tmp/cherry-backup.zip')
    deleteLanTransferBackupMock.mockResolvedValue(undefined)

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        backup: {
          createLanTransferBackup: createLanTransferBackupMock,
          deleteLanTransferBackup: deleteLanTransferBackupMock
        },
        lanTransfer: {
          cancelTransfer: vi.fn().mockResolvedValue(undefined),
          connect: connectMock,
          disconnect: vi.fn().mockResolvedValue(undefined),
          onClientEvent: vi.fn(() => vi.fn()),
          onServicesUpdated: vi.fn(() => vi.fn()),
          sendFile: sendFileMock,
          startScan: startScanMock,
          stopScan: stopScanMock
        }
      }
    })
  })

  it('preserves nested file-send failure details in peer state', async () => {
    sendFileMock.mockRejectedValueOnce({ error: { message: 'peer closed the connection' } })
    const { result } = renderHook(() => useLanTransfer())

    await waitFor(() => {
      expect(result.current.lanDevices).toHaveLength(1)
    })

    await act(async () => {
      await result.current.handleSendFile('peer-1')
    })

    await waitFor(() => {
      expect(result.current.getTransferState('peer-1')).toMatchObject({
        status: 'failed',
        error: 'peer closed the connection'
      })
    })
    expect(connectMock).toHaveBeenCalledWith({ peerId: 'peer-1' })
    expect(createLanTransferBackupMock).toHaveBeenCalledWith({ settings: { version: 1 } })
    expect(deleteLanTransferBackupMock).toHaveBeenCalledWith('/tmp/cherry-backup.zip')
  })
})

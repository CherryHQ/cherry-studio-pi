import { FILE_TYPE } from '@renderer/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAttachment } from '../useAttachment'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/components/Popups/TextFilePreview', () => ({
  default: {
    show: vi.fn()
  }
}))

const openPathMock = vi.fn()
const readTextMock = vi.fn()
const modalErrorMock = vi.fn()

describe('useAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...window.api,
        file: {
          ...window.api?.file,
          openPath: openPathMock
        },
        fs: {
          ...window.api?.fs,
          readText: readTextMock
        }
      }
    })
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: {
        ...window.modal,
        error: modalErrorMock
      }
    })
  })

  it('shows the preview error when opening a non-text attachment fails', async () => {
    openPathMock.mockRejectedValueOnce(new Error('open failed'))

    const { result } = renderHook(() => useAttachment())

    await act(async () => {
      await result.current.preview('/tmp/report.pdf', 'report.pdf', FILE_TYPE.DOCUMENT)
    })

    await waitFor(() => {
      expect(modalErrorMock).toHaveBeenCalledWith({ content: 'files.preview.error', centered: true })
    })
  })
})

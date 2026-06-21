import { beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadImages } from '../downloadImages'
import { fileEntryToMetadata } from '../fileEntryAdapter'

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('../fileEntryAdapter', () => ({
  fileEntryToMetadata: vi.fn()
}))

describe('downloadImages', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          createInternalEntry: vi.fn()
        }
      }
    })
    vi.mocked(fileEntryToMetadata).mockReset()
  })

  it('does not crash on empty image urls before toast is available', async () => {
    await expect(downloadImages([''], { showProxyWarning: true })).resolves.toEqual([])

    expect(window.api.file.createInternalEntry).not.toHaveBeenCalled()
  })

  it('does not crash on invalid url errors before toast is available', async () => {
    vi.mocked(window.api.file.createInternalEntry).mockRejectedValue(new Error('Invalid URL'))

    await expect(downloadImages(['not-a-url'])).resolves.toEqual([])
  })

  it('does not crash on proxy warning errors before toast is available', async () => {
    vi.mocked(window.api.file.createInternalEntry).mockRejectedValue(new Error('network timeout'))

    await expect(downloadImages(['https://example.com/image.png'], { showProxyWarning: true })).resolves.toEqual([])
  })
})

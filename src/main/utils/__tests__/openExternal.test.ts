import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  logger: {
    warn: vi.fn()
  }
}))

vi.mock('electron', () => ({
  shell: {
    openExternal: mocks.openExternal
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

import { openExternalUrl } from '../openExternal'

describe('openExternalUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens safe external URLs', () => {
    openExternalUrl('https://example.com/page', 'test link')

    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/page')
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })

  it('blocks unsafe external URL schemes before reaching Electron', () => {
    openExternalUrl('javascript:alert(1)', 'test link')

    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith('Blocked unsafe test link', {
      url: {
        type: 'url',
        protocol: 'javascript:',
        host: '',
        pathnameLength: 8,
        searchLength: 0,
        hashLength: 0,
        hasSearch: false,
        hasHash: false
      }
    })
  })

  it('summarizes blocked external URLs without logging embedded credentials', () => {
    openExternalUrl('ftp://user:secret@example.com/download?token=abc#secret', 'test link')

    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain('token=abc')
    expect(mocks.logger.warn).toHaveBeenCalledWith('Blocked unsafe test link', {
      url: {
        type: 'url',
        protocol: 'ftp:',
        host: 'example.com',
        pathnameLength: 9,
        searchLength: 10,
        hashLength: 7,
        hasSearch: true,
        hasHash: true
      }
    })
  })

  it('summarizes safe external URLs when Electron fails to open them', async () => {
    const error = new Error('open failed')
    mocks.openExternal.mockRejectedValueOnce(error)

    openExternalUrl('https://example.com/path?token=abc#secret', 'test link')
    await vi.waitFor(() => expect(mocks.logger.warn).toHaveBeenCalled())

    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain('token=abc')
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain('#secret')
    expect(mocks.logger.warn).toHaveBeenCalledWith('Failed to open test link', {
      url: {
        type: 'url',
        protocol: 'https:',
        host: 'example.com',
        pathnameLength: 5,
        searchLength: 10,
        hashLength: 7,
        hasSearch: true,
        hasHash: true
      },
      error
    })
  })
})

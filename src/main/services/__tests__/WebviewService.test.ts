import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setWindowOpenHandler: vi.fn(),
  openExternal: vi.fn(),
  logger: {
    warn: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {},
  dialog: {},
  session: {},
  shell: {
    openExternal: mocks.openExternal
  },
  webContents: {
    fromId: vi.fn(() => ({
      setWindowOpenHandler: mocks.setWindowOpenHandler
    }))
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    ipcHandle = vi.fn()
  }
  return { ...actual, BaseService: StubBase }
})

import { setOpenLinkExternal } from '../WebviewService'

describe('setOpenLinkExternal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens safe external URLs and denies the webview popup', () => {
    setOpenLinkExternal(1, true)
    const handler = mocks.setWindowOpenHandler.mock.calls[0][0]

    const result = handler({ url: 'https://example.com' })

    expect(result).toEqual({ action: 'deny' })
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('blocks unsafe external URL schemes', () => {
    setOpenLinkExternal(1, true)
    const handler = mocks.setWindowOpenHandler.mock.calls[0][0]

    const result = handler({ url: 'javascript:alert(1)' })

    expect(result).toEqual({ action: 'deny' })
    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalled()
  })

  it('allows webview popups when external mode is disabled', () => {
    setOpenLinkExternal(1, false)
    const handler = mocks.setWindowOpenHandler.mock.calls[0][0]

    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'allow' })
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})

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
    expect(mocks.logger.warn).toHaveBeenCalledWith('Blocked unsafe test link: javascript:alert(1)')
  })
})

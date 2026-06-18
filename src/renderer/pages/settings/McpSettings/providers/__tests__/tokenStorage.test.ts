import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notifyStorageV2MirroredLocalStorageKeyChanged: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: mocks.warn
    })
  }
}))

vi.mock('@renderer/services/StorageV2LocalStorageSnapshot', () => ({
  notifyStorageV2MirroredLocalStorageKeyChanged: mocks.notifyStorageV2MirroredLocalStorageKeyChanged
}))

import { clearMcpProviderToken, getMcpProviderToken, saveMcpProviderToken } from '../tokenStorage'

describe('MCP provider token storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('saves and mirrors provider token changes', () => {
    expect(saveMcpProviderToken('mcprouter_token', 'secret')).toBe(true)

    expect(localStorage.getItem('mcprouter_token')).toBe('secret')
    expect(mocks.notifyStorageV2MirroredLocalStorageKeyChanged).toHaveBeenCalledWith('mcprouter_token')
  })

  it('reads provider tokens from localStorage', () => {
    localStorage.setItem('modelscope_token', 'modelscope-secret')

    expect(getMcpProviderToken('modelscope_token')).toBe('modelscope-secret')
  })

  it('clears and mirrors provider token removals', () => {
    localStorage.setItem('bailian_token', 'secret')

    expect(clearMcpProviderToken('bailian_token')).toBe(true)

    expect(localStorage.getItem('bailian_token')).toBeNull()
    expect(mocks.notifyStorageV2MirroredLocalStorageKeyChanged).toHaveBeenCalledWith('bailian_token', {
      cleared: true
    })
  })

  it('returns null instead of throwing when token reads are blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })

    expect(getMcpProviderToken('mcprouter_token')).toBeNull()
    expect(mocks.warn).toHaveBeenCalled()
  })

  it('does not mirror token writes that fail locally', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })

    expect(saveMcpProviderToken('mcprouter_token', 'secret')).toBe(false)
    expect(mocks.notifyStorageV2MirroredLocalStorageKeyChanged).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalled()
  })

  it('does not mirror token clears that fail locally', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })

    expect(clearMcpProviderToken('mcprouter_token')).toBe(false)
    expect(mocks.notifyStorageV2MirroredLocalStorageKeyChanged).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalled()
  })
})

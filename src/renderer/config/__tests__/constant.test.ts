import { describe, expect, it, vi } from 'vitest'

describe('renderer config constants', () => {
  it('can be imported without a browser window', async () => {
    vi.resetModules()
    vi.stubGlobal('window', undefined)

    try {
      const constants = await import('../constant')

      expect(constants.platform).toBeUndefined()
      expect(constants.isMac).toBe(false)
      expect(constants.isWin).toBe(false)
      expect(constants.isLinux).toBe(false)
      expect(constants.isDev).toBe(false)
      expect(constants.isProd).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

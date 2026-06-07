import { afterEach, describe, expect, it, vi } from 'vitest'

import { isHttpExternalUrl, openHttpExternalUrl } from '../openExternal'

describe('isHttpExternalUrl', () => {
  it('allows http and https URLs', () => {
    expect(isHttpExternalUrl('http://example.com')).toBe(true)
    expect(isHttpExternalUrl('https://example.com/path?q=1')).toBe(true)
    expect(isHttpExternalUrl(' HTTPS://example.com ')).toBe(true)
  })

  it('rejects non-web or malformed URLs', () => {
    expect(isHttpExternalUrl('')).toBe(false)
    expect(isHttpExternalUrl(null)).toBe(false)
    expect(isHttpExternalUrl('example.com')).toBe(false)
    expect(isHttpExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isHttpExternalUrl('vscode://file/Users/me/app.ts')).toBe(false)
  })
})

describe('openHttpExternalUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens valid URLs with a hardened blank target', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    expect(openHttpExternalUrl(' https://example.com/docs ')).toBe(true)
    expect(openSpy).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
  })

  it('ignores unsafe URLs', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    expect(openHttpExternalUrl('javascript:alert(1)')).toBe(false)
    expect(openHttpExternalUrl('file:///etc/passwd')).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
  })
})

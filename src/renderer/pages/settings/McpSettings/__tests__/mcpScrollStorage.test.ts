import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readMcpListScrollTop, writeMcpListScrollTop } from '../mcpScrollStorage'

describe('MCP list scroll storage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('round-trips a finite scroll position', () => {
    writeMcpListScrollTop(128)

    expect(readMcpListScrollTop()).toBe(128)
  })

  it('ignores invalid stored scroll positions', () => {
    sessionStorage.setItem('mcp-list-scroll', 'not-a-number')

    expect(readMcpListScrollTop()).toBeNull()
  })

  it('returns null when sessionStorage reads are blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })

    expect(readMcpListScrollTop()).toBeNull()
  })

  it('does not throw when sessionStorage writes are blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })

    expect(() => writeMcpListScrollTop(256)).not.toThrow()
  })
})

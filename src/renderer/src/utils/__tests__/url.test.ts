import { describe, expect, it } from 'vitest'

import { canFetchLinkPreviewMetadata, getUrlOriginOrFallback } from '../url'

describe('url utils', () => {
  it('returns origin or the original value', () => {
    expect(getUrlOriginOrFallback('https://example.com/path')).toBe('https://example.com')
    expect(getUrlOriginOrFallback('not-url')).toBe('not-url')
  })

  it('allows ordinary public http links for metadata previews', () => {
    expect(canFetchLinkPreviewMetadata('https://example.com/post?id=1')).toBe(true)
  })

  it('blocks private network links from metadata previews', () => {
    expect(canFetchLinkPreviewMetadata('http://192.168.1.100:8080/')).toBe(false)
    expect(canFetchLinkPreviewMetadata('http://10.0.0.2/dav')).toBe(false)
    expect(canFetchLinkPreviewMetadata('http://localhost:8080/')).toBe(false)
  })

  it('blocks links with credential material or encoded line breaks', () => {
    expect(canFetchLinkPreviewMetadata('http://example.com/%0A%0A%E8%B4%A6%E5%8F%B7%EF%BC%9Awebdav')).toBe(false)
    expect(canFetchLinkPreviewMetadata('http://example.com/\n账号：webdav')).toBe(false)
    expect(canFetchLinkPreviewMetadata('https://user:pass@example.com/dav')).toBe(false)
  })

  it('blocks non-http links', () => {
    expect(canFetchLinkPreviewMetadata('mailto:test@example.com')).toBe(false)
    expect(canFetchLinkPreviewMetadata('file:///tmp/test.html')).toBe(false)
  })
})

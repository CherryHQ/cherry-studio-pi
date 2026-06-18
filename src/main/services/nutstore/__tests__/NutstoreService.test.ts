import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@shared/config/nutstore', () => ({
  NUTSTORE_HOST: 'https://nutstore.test/dav'
}))

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn()
  }
}))

const { getDirectoryContents } = await import('../NutstoreService')

function propfindResponse(options: { link?: string; itemHref?: string } = {}): Response {
  const item = options.itemHref
    ? `
      <d:response>
        <d:href>${options.itemHref}</d:href>
        <d:propstat>
          <d:prop>
            <d:displayname>file.txt</d:displayname>
            <d:getcontentlength>3</d:getcontentlength>
            <d:getcontenttype>text/plain</d:getcontenttype>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`
    : ''

  return {
    ok: true,
    status: 207,
    statusText: 'Multi-Status',
    headers: new Headers(options.link ? { link: options.link } : {}),
    text: async () => `
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/dav/folder/</d:href>
          <d:propstat>
            <d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
        ${item}
      </d:multistatus>
    `
  } as Response
}

describe('NutstoreService', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset()
  })

  it('bounds directory listing requests with a timeout signal', async () => {
    vi.mocked(net.fetch).mockResolvedValue(propfindResponse({ itemHref: '/dav/folder/file.txt' }))

    const contents = await getDirectoryContents('token', '/folder')

    expect(contents).toHaveLength(1)
    expect(net.fetch).toHaveBeenCalledWith(
      'https://nutstore.test/dav/folder',
      expect.objectContaining({
        method: 'PROPFIND',
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('does not strip server base from sibling-prefix hrefs', async () => {
    vi.mocked(net.fetch).mockResolvedValue(propfindResponse({ itemHref: '/dav2/file.txt' }))

    const contents = await getDirectoryContents('token', '/folder')

    expect(contents[0]?.filename).toBe('/dav2/file.txt')
  })

  it('stops directory pagination when a next link points to an already visited page', async () => {
    vi.mocked(net.fetch).mockResolvedValue(propfindResponse({ link: '<https://nutstore.test/dav/folder>; rel="next"' }))

    await getDirectoryContents('token', '/folder')

    expect(net.fetch).toHaveBeenCalledTimes(1)
  })
})

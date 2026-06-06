import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('electron', () => ({
  net: {
    fetch: mocks.fetch
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('@shared/config/nutstore', () => ({
  NUTSTORE_HOST: 'https://dav.example.com/dav'
}))

import { getDirectoryContents } from '../NutstoreService'

function webdavXml(entries: Array<{ href: string; dir?: boolean; size?: number }>) {
  return `<?xml version="1.0" encoding="utf-8"?>
    <d:multistatus xmlns:d="DAV:">
      ${entries
        .map(
          (entry) => `
            <d:response>
              <d:href>${entry.href}</d:href>
              <d:propstat>
                <d:prop>
                  <d:resourcetype>${entry.dir ? '<d:collection/>' : ''}</d:resourcetype>
                  <d:getcontentlength>${entry.size ?? 0}</d:getcontentlength>
                  <d:getlastmodified>Sat, 06 Jun 2026 00:00:00 GMT</d:getlastmodified>
                  <d:getcontenttype>${entry.dir ? '' : 'text/plain'}</d:getcontenttype>
                </d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>`
        )
        .join('')}
    </d:multistatus>`
}

function response(body: string, status = 207, headers: Record<string, string> = {}) {
  return {
    status,
    statusText: status === 207 ? 'Multi-Status' : 'Error',
    headers: new Headers(headers),
    text: vi.fn().mockResolvedValue(body)
  }
}

describe('NutstoreService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses fetch Headers.get and follows paginated directory links', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        response(
          webdavXml([
            { href: '/dav/', dir: true },
            { href: '/dav/folder%20one/', dir: true }
          ]),
          207,
          { link: '</dav/page-2>; rel="next"' }
        )
      )
      .mockResolvedValueOnce(
        response(
          webdavXml([
            { href: '/dav/page-2', dir: true },
            { href: '/dav/second.txt', size: 12 }
          ])
        )
      )

    const result = await getDirectoryContents('token', '/')

    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      'https://dav.example.com/dav/',
      expect.objectContaining({ method: 'PROPFIND' })
    )
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      'https://dav.example.com/dav/page-2',
      expect.objectContaining({ method: 'PROPFIND' })
    )
    expect(result.map((item) => item.filename)).toEqual(['/folder one', '/second.txt'])
  })

  it('keeps malformed encoded hrefs instead of throwing while browsing directories', async () => {
    mocks.fetch.mockResolvedValueOnce(
      response(
        webdavXml([
          { href: '/dav/', dir: true },
          { href: '/dav/bad%name.txt', size: 7 }
        ])
      )
    )

    await expect(getDirectoryContents('token', '/')).resolves.toMatchObject([
      {
        filename: '/bad%name.txt',
        basename: 'bad%name.txt',
        size: 7
      }
    ])
  })

  it('throws a clear error for non-success responses before parsing the body as WebDAV XML', async () => {
    mocks.fetch.mockResolvedValueOnce(response('Unauthorized', 401))

    await expect(getDirectoryContents('token', '/')).rejects.toThrow('Nutstore request failed: 401 Error: Unauthorized')
  })
})

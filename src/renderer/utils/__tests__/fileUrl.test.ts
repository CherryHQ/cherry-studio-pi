import { describe, expect, it } from 'vitest'

import { fileUrlToPath, pathToFileUrl } from '../fileUrl'

describe('pathToFileUrl', () => {
  it('encodes POSIX paths without treating spaces, query, or hash characters as URL syntax', () => {
    expect(pathToFileUrl('/Users/me/My File #1?.png')).toBe('file:///Users/me/My%20File%20%231%3F.png')
  })

  it('encodes Windows drive paths', () => {
    expect(pathToFileUrl('C:\\Users\\me\\My File 中文.pdf')).toBe(
      'file:///C:/Users/me/My%20File%20%E4%B8%AD%E6%96%87.pdf'
    )
  })

  it('encodes UNC paths while preserving the host', () => {
    expect(pathToFileUrl('\\\\server\\share\\My File.pdf')).toBe('file://server/share/My%20File.pdf')
  })

  it('passes existing file URLs through unchanged', () => {
    expect(pathToFileUrl('file:///Users/me/My%20File.pdf')).toBe('file:///Users/me/My%20File.pdf')
  })

  it('treats bare filenames as local paths instead of file URL hosts', () => {
    expect(pathToFileUrl('My File #1?.png')).toBe('file:///My%20File%20%231%3F.png')
  })
})

describe('fileUrlToPath', () => {
  it('decodes POSIX file URLs', () => {
    expect(fileUrlToPath('file:///Users/me/My%20File%20%E4%B8%AD%E6%96%87.pdf')).toBe('/Users/me/My File 中文.pdf')
  })

  it('decodes Windows drive file URLs', () => {
    expect(fileUrlToPath('file:///C:/Users/me/My%20File.pdf')).toBe('C:/Users/me/My File.pdf')
  })

  it('decodes UNC file URLs', () => {
    expect(fileUrlToPath('file://server/share/My%20File.pdf')).toBe('//server/share/My File.pdf')
  })

  it('passes non-file URLs through unchanged', () => {
    expect(fileUrlToPath('https://example.com/file.pdf')).toBe('https://example.com/file.pdf')
  })

  it('passes plain local paths through unchanged', () => {
    expect(fileUrlToPath('/Users/me/My File.pdf')).toBe('/Users/me/My File.pdf')
  })

  it('passes malformed file URLs through unchanged', () => {
    expect(fileUrlToPath('file:///%E0%A4%A')).toBe('file:///%E0%A4%A')
  })

  it('passes invalid URL-like file strings through unchanged', () => {
    expect(fileUrlToPath('file://[broken')).toBe('file://[broken')
  })
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import FileService from '../FileSystemService'

describe('FileSystemService', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-file-service-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('reads ordinary local paths', async () => {
    const filePath = path.join(tempDir, 'plain.txt')
    await fs.writeFile(filePath, 'hello', 'utf8')

    await expect(FileService.readFile(undefined as never, filePath, 'utf8')).resolves.toBe('hello')
  })

  it('reads file URLs as local files', async () => {
    const filePath = path.join(tempDir, 'url.txt')
    await fs.writeFile(filePath, 'from-url', 'utf8')

    await expect(FileService.readFile(undefined as never, pathToFileURL(filePath).href, 'utf8')).resolves.toBe(
      'from-url'
    )
  })

  it('normalizes file URLs before auto-detecting text encoding', async () => {
    const filePath = path.join(tempDir, 'text.txt')
    await fs.writeFile(filePath, 'text from url', 'utf8')

    await expect(
      FileService.readTextFileWithAutoEncoding(undefined as never, pathToFileURL(filePath).href)
    ).resolves.toBe('text from url')
  })

  it('rejects non-file URL schemes before treating input as a path', async () => {
    await expect(FileService.readFile(undefined as never, 'https://example.com/file.txt')).rejects.toThrow(
      'URL schemes are not allowed'
    )
    await expect(FileService.readFile(undefined as never, 'javascript:alert(1)')).rejects.toThrow(
      'URL schemes are not allowed'
    )
  })

  it('rejects empty and NUL-containing paths', async () => {
    await expect(FileService.readFile(undefined as never, '   ')).rejects.toThrow('empty path')
    await expect(FileService.readTextFileWithAutoEncoding(undefined as never, '/tmp/file.txt\0.png')).rejects.toThrow(
      'NUL bytes'
    )
  })

  it('keeps Windows drive-letter paths as local paths', async () => {
    await expect(FileService.readFile(undefined as never, 'C:\\missing\\file.txt')).rejects.not.toThrow(
      'URL schemes are not allowed'
    )
  })
})

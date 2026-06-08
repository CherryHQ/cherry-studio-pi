import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { readTextFileWithAutoEncoding } from '@main/utils/file'
import { TraceMethod } from '@mcp-trace/trace-core'

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:(?:[\\/]|$)/

function normalizeLocalFileInput(pathOrUrl: string): string | URL {
  if (typeof pathOrUrl !== 'string' || pathOrUrl.trim().length === 0) {
    throw new Error('Invalid file path: empty path')
  }

  if (pathOrUrl.includes('\0')) {
    throw new Error('Invalid file path: NUL bytes are not allowed')
  }

  const trimmedInput = pathOrUrl.trimStart()
  if (trimmedInput.startsWith('file://')) {
    const url = new URL(trimmedInput)
    if (url.protocol !== 'file:') {
      throw new Error('Invalid file path: only file:// URLs are allowed')
    }
    return url
  }

  if (URL_SCHEME_PATTERN.test(trimmedInput) && !WINDOWS_DRIVE_PATH_PATTERN.test(trimmedInput)) {
    throw new Error('Invalid file path: URL schemes are not allowed')
  }

  return pathOrUrl
}

function normalizeLocalFilePathString(pathOrUrl: string): string {
  const localInput = normalizeLocalFileInput(pathOrUrl)
  return localInput instanceof URL ? fileURLToPath(localInput) : localInput
}

export default class FileService {
  @TraceMethod({ spanName: 'readFile', tag: 'FileService' })
  public static async readFile(_: Electron.IpcMainInvokeEvent, pathOrUrl: string, encoding?: BufferEncoding) {
    const path = normalizeLocalFileInput(pathOrUrl)
    if (encoding) return fs.readFile(path, { encoding })
    return fs.readFile(path)
  }

  /**
   * 自动识别编码，读取文本文件
   * @param _ event
   * @param pathOrUrl
   * @throws 路径不存在时抛出错误
   */
  @TraceMethod({ spanName: 'readTextFileWithAutoEncoding', tag: 'FileService' })
  public static async readTextFileWithAutoEncoding(_: Electron.IpcMainInvokeEvent, path: string): Promise<string> {
    return readTextFileWithAutoEncoding(normalizeLocalFilePathString(path))
  }
}

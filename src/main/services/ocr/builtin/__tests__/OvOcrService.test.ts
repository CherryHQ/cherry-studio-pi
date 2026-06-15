import { FILE_TYPE } from '@shared/file/types'
import type { SupportedOcrFile } from '@types'
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OvOcrService } from '../OvOcrService'

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerMocks.error,
      info: loggerMocks.info,
      warn: loggerMocks.warn
    })
  }
}))

vi.mock('@main/core/platform', () => ({
  isWin: true
}))

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

describe('OvOcrService', () => {
  let tempRoot: string
  const workingDirectories: string[] = []

  beforeEach(async () => {
    vi.clearAllMocks()
    workingDirectories.length = 0
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ovocr-service-test-'))

    vi.mocked(execFile).mockImplementation((_file, _args, options, callback) => {
      const cwd = typeof options === 'object' && options ? options.cwd?.toString() : undefined
      const done = typeof options === 'function' ? options : callback

      if (!cwd || !done) {
        throw new Error('OV OCR test execFile mock requires cwd and callback')
      }

      workingDirectories.push(cwd)

      void (async () => {
        const [fileName] = await fs.promises.readdir(path.join(cwd, 'img'))
        const baseName = path.basename(fileName, path.extname(fileName))
        await fs.promises.writeFile(path.join(cwd, 'output', `${baseName}.txt`), 'ocr result', 'utf8')
        done(null, '', '')
      })().catch((error) => done(error, '', ''))

      return {} as never
    })
  })

  afterEach(async () => {
    await fs.promises.rm(tempRoot, { recursive: true, force: true })
  })

  it('uses an isolated temporary working directory and cleans it after OCR', async () => {
    const sourcePath = path.join(tempRoot, 'scan.png')
    await fs.promises.writeFile(sourcePath, 'image')

    const service = new OvOcrService()
    const result = await service.ocr({
      path: sourcePath,
      type: FILE_TYPE.IMAGE
    } as SupportedOcrFile)

    expect(result).toEqual({ text: 'ocr result' })
    expect(execFile).toHaveBeenCalledWith(
      'cmd.exe',
      expect.arrayContaining(['/d', '/s', '/c']),
      expect.objectContaining({
        cwd: workingDirectories[0],
        timeout: 60000,
        windowsHide: true
      }),
      expect.any(Function)
    )
    expect(workingDirectories).toHaveLength(1)
    await expect(fs.promises.stat(workingDirectories[0])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not write source file names or OCR text into logs', async () => {
    const sourcePath = path.join(tempRoot, 'private-id-card.png')
    await fs.promises.writeFile(sourcePath, 'image')

    const service = new OvOcrService()
    await service.ocr({
      path: sourcePath,
      type: FILE_TYPE.IMAGE
    } as SupportedOcrFile)

    const serializedLogs = JSON.stringify(loggerMocks.info.mock.calls)

    expect(serializedLogs).not.toContain(sourcePath)
    expect(serializedLogs).not.toContain('private-id-card.png')
    expect(serializedLogs).not.toContain('ocr result')
    expect(loggerMocks.info).toHaveBeenCalledWith('OV OCR text extracted', {
      text: expect.objectContaining({ length: 'ocr result'.length })
    })
  })
})

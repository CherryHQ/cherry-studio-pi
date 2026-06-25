import type { FileMetadata } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { ipcRequestMock, runPaintingMock } = vi.hoisted(() => ({
  ipcRequestMock: vi.fn(),
  runPaintingMock: vi.fn(async (generate: () => Promise<{ files?: FileMetadata[] } | undefined>) => {
    const result = await generate()
    return result?.files ?? []
  })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
}))

vi.mock('../runPainting', () => ({
  runPainting: (generate: () => Promise<{ files?: FileMetadata[] } | undefined>) => runPaintingMock(generate)
}))

vi.mock('../../utils/fileEntryAdapter', () => ({
  fileEntryToMetadata: vi.fn()
}))

import { fileEntryToMetadata } from '../../utils/fileEntryAdapter'
import type { GeneratePaintingOptions } from '../generatePainting'
import { generatePainting } from '../generatePainting'

const generatedFile: FileMetadata = {
  id: 'file-1',
  name: 'file-1.png',
  origin_name: 'file-1.png',
  path: 'internal://file-1.png',
  size: 123,
  ext: '.png',
  type: 'image',
  created_at: '2026-06-07T00:00:00.000Z',
  count: 1
}

const fileEntry = { id: 'entry-1', name: 'file-1.png' } as unknown as FileEntry
let originalCrypto: Crypto

function createOptions(
  signal: AbortSignal,
  aiSdkParams: GeneratePaintingOptions['aiSdkParams'] = {}
): GeneratePaintingOptions {
  return {
    provider: {
      id: 'openai',
      name: 'OpenAI',
      apiHost: 'https://example.com',
      isEnabled: true,
      getApiKey: vi.fn(async () => 'api-key')
    },
    signal,
    modelId: 'gpt-image-1',
    prompt: 'a quiet studio',
    aiSdkParams
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('generatePainting', () => {
  beforeEach(() => {
    originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: vi.fn(() => 'request-1') }
    })
    runPaintingMock.mockClear()
    ipcRequestMock.mockReset()
    ipcRequestMock.mockImplementation(async (route: string) =>
      route === 'ai.generate_image' ? { files: [fileEntry] } : undefined
    )
    vi.mocked(fileEntryToMetadata).mockResolvedValue(generatedFile)
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto
    })
    vi.restoreAllMocks()
  })

  it('does not start an IPC image request when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(generatePainting(createOptions(controller.signal))).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Image generation aborted'
    })
    expect(ipcRequestMock).not.toHaveBeenCalled()
  })

  it('sends the image payload through ai.generate_image', async () => {
    const controller = new AbortController()

    await expect(
      generatePainting(
        createOptions(controller.signal, {
          imageSize: '1024x1024',
          batchSize: 2,
          negativePrompt: 'blur',
          inputImages: ['data:image/png;base64,a']
        })
      )
    ).resolves.toEqual([generatedFile])

    expect(ipcRequestMock).toHaveBeenCalledWith('ai.generate_image', {
      requestId: 'request-1',
      payload: expect.objectContaining({
        uniqueModelId: 'openai::gpt-image-1',
        prompt: 'a quiet studio',
        inputImages: ['data:image/png;base64,a'],
        n: 2,
        size: '1024x1024',
        negativePrompt: 'blur'
      })
    })
  })

  it('aborts an in-flight IPC request and skips persisted-file adaptation', async () => {
    const controller = new AbortController()
    const deferred = createDeferred<{ files: FileEntry[] }>()
    ipcRequestMock.mockImplementation((route: string) => {
      if (route === 'ai.generate_image') return deferred.promise
      return Promise.resolve(undefined)
    })

    const promise = generatePainting(createOptions(controller.signal))

    controller.abort()
    expect(ipcRequestMock).toHaveBeenCalledWith('ai.abort_image', { requestId: 'request-1' })

    deferred.resolve({ files: [fileEntry] })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(fileEntryToMetadata).not.toHaveBeenCalled()
  })

  it('removes the abort listener after a successful generation', async () => {
    const controller = new AbortController()

    await expect(generatePainting(createOptions(controller.signal))).resolves.toEqual([generatedFile])

    ipcRequestMock.mockClear()
    controller.abort()
    expect(ipcRequestMock).not.toHaveBeenCalledWith('ai.abort_image', expect.anything())
  })

  it('re-throws a real AbortError when the request rejects after the user aborted', async () => {
    const controller = new AbortController()
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'ai.generate_image') throw new Error('cancelled by main')
      return undefined
    })

    const promise = generatePainting(createOptions(controller.signal))
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('re-throws the original error when the request rejects without a user abort', async () => {
    const failure = new Error('provider exploded')
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'ai.generate_image') throw failure
      return undefined
    })

    await expect(generatePainting(createOptions(new AbortController().signal))).rejects.toBe(failure)
  })
})

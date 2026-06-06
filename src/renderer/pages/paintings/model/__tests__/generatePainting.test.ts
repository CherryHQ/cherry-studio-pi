import type { FileMetadata } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fileEntryToMetadata } from '../../utils/fileEntryAdapter'
import type { GeneratePaintingOptions } from '../generatePainting'
import { generatePainting } from '../generatePainting'

vi.mock('../../utils/fileEntryAdapter', () => ({
  fileEntryToMetadata: vi.fn()
}))

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

const generateImageMock = vi.fn()
const abortImageMock = vi.fn()
let originalCrypto: Crypto

function createOptions(signal: AbortSignal): GeneratePaintingOptions {
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
    aiSdkParams: {}
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
    ;(window as unknown as { api: unknown }).api = {
      ai: {
        generateImage: generateImageMock,
        abortImage: abortImageMock
      }
    }
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
    expect(generateImageMock).not.toHaveBeenCalled()
    expect(abortImageMock).not.toHaveBeenCalled()
  })

  it('aborts an in-flight IPC request and skips persisted-file adaptation', async () => {
    const controller = new AbortController()
    const deferred = createDeferred<{ files: FileEntry[] }>()
    generateImageMock.mockReturnValueOnce(deferred.promise)

    const promise = generatePainting(createOptions(controller.signal))
    expect(generateImageMock).toHaveBeenCalledWith(
      {
        uniqueModelId: 'openai::gpt-image-1',
        prompt: 'a quiet studio'
      },
      'request-1'
    )

    controller.abort()
    expect(abortImageMock).toHaveBeenCalledWith('request-1')

    deferred.resolve({ files: [fileEntry] })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(fileEntryToMetadata).not.toHaveBeenCalled()
  })

  it('removes the abort listener after a successful generation', async () => {
    const controller = new AbortController()
    generateImageMock.mockResolvedValueOnce({ files: [fileEntry] })

    await expect(generatePainting(createOptions(controller.signal))).resolves.toEqual([generatedFile])

    controller.abort()
    expect(abortImageMock).not.toHaveBeenCalled()
  })
})

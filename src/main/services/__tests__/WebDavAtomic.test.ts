import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeWebDavJsonAtomically } from '../WebDavAtomic'

const logger = {
  warn: vi.fn()
}

describe('WebDavAtomic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects oversized remote JSON verification responses before downloading them', async () => {
    const client = {
      stat: vi.fn(async () => ({ size: 2 * 1024 * 1024 })),
      getFileContents: vi.fn(),
      putFileContents: vi.fn(),
      deleteFile: vi.fn()
    }

    await expect(
      writeWebDavJsonAtomically(
        client as any,
        '/sync/v1/manifest.json',
        { ok: true },
        {
          logger,
          operation: 'test sync json',
          overwrite: false,
          maxVerifyBytes: 1024
        }
      )
    ).rejects.toThrow('无法完成写入校验')

    expect(client.stat).toHaveBeenCalledWith('/sync/v1/manifest.json')
    expect(client.getFileContents).not.toHaveBeenCalled()
    expect(client.putFileContents).not.toHaveBeenCalled()
  })

  it('does not let a stalled temporary delete keep a successful atomic write pending forever', async () => {
    vi.useFakeTimers()
    const client = {
      getFileContents: vi.fn(async () => JSON.stringify({ ok: true })),
      putFileContents: vi.fn(async () => true),
      deleteFile: vi.fn(() => new Promise<void>(() => undefined))
    }

    const promise = writeWebDavJsonAtomically(
      client as any,
      '/sync/v1/manifest.json',
      { ok: true },
      {
        logger,
        operation: 'test sync json',
        timeoutMs: 1
      }
    )

    await vi.advanceTimersByTimeAsync(2_000)
    await expect(promise).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete temporary remote file'),
      expect.any(Error)
    )
  })
})

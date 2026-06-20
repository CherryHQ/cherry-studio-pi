import { describe, expect, it, vi } from 'vitest'

import { CHANNEL_API_ERROR_TEXT_MAX_BYTES, readChannelApiErrorText } from '../apiErrorPreview'

describe('channel API error previews', () => {
  it('bounds streamed API error bodies before returning previews', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const text = vi.fn()
    const response = {
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('x'.repeat(CHANNEL_API_ERROR_TEXT_MAX_BYTES + 1))
          }),
          cancel,
          releaseLock
        })
      },
      text
    } as unknown as Response

    const preview = await readChannelApiErrorText(response)

    expect(preview).toBe(`${'x'.repeat(CHANNEL_API_ERROR_TEXT_MAX_BYTES)}\n[truncated]`)
    expect(cancel).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
  })
})

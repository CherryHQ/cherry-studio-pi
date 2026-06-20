import { describe, expect, it, vi } from 'vitest'

import { readResponseTextWithinLimit } from '../readResponseText'

describe('readResponseTextWithinLimit', () => {
  it('cancels streamed responses after the configured byte limit', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const text = vi.fn()
    const response = {
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('abcdef')
          }),
          cancel,
          releaseLock
        })
      },
      text
    } as unknown as Response

    const result = await readResponseTextWithinLimit(response, 3)

    expect(result).toEqual({
      text: 'abc',
      truncated: true,
      bytesRead: 3
    })
    expect(cancel).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
  })
})

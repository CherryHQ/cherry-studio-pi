import { describe, expect, it, vi } from 'vitest'

import { BRAVE_ERROR_TEXT_MAX_BYTES, buildBraveApiErrorMessage } from '../brave-search'

describe('Brave Search MCP server', () => {
  it('bounds streamed API error bodies before building the error message', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const text = vi.fn()
    const response = {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('x'.repeat(BRAVE_ERROR_TEXT_MAX_BYTES + 1))
          }),
          cancel,
          releaseLock
        })
      },
      text
    } as unknown as Response

    const message = await buildBraveApiErrorMessage(response)

    expect(message).toContain(`Brave API error: 502 Bad Gateway\n${'x'.repeat(BRAVE_ERROR_TEXT_MAX_BYTES)}`)
    expect(message).toContain('[truncated]')
    expect(cancel).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
  })
})

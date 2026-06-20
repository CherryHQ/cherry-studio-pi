import { describe, expect, it, vi } from 'vitest'

import DifyKnowledgeServer from '../dify-knowledge'

describe('Dify knowledge MCP server', () => {
  it('bounds streamed API error bodies before returning MCP errors', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const text = vi.fn()
    const response = {
      ok: false,
      status: 502,
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('x'.repeat(4097))
          }),
          cancel,
          releaseLock
        })
      },
      text
    } as unknown as Response
    const server = new DifyKnowledgeServer('test-key', ['https://dify.example'])

    const preview = await (server as any).readApiErrorText(response)

    expect(preview).toContain('[truncated]')
    expect(preview.length).toBeLessThan(4097 + 32)
    expect(cancel).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
  })
})

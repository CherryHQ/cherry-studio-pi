import { describe, expect, it, vi } from 'vitest'

import { DiDiMcpServer } from '../didi-mcp'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('DiDiMcpServer', () => {
  it('caps streamed HTTP error previews without reading the full body', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(5000)))
      },
      cancel
    })
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 503 }))
    const server = new DiDiMcpServer('didi-key') as unknown as {
      makeRequest(method: string, params: Record<string, unknown>): Promise<unknown>
    }

    try {
      await expect(server.makeRequest('maps.textsearch', {})).rejects.toThrow(
        `HTTP 503: ${'x'.repeat(4096)}\n...[truncated]`
      )
      expect(cancel).toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
})

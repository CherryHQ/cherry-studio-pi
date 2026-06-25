/**
 * Regression for tool-approval-5: main signals failure via a resolved `{ ok: false }`.
 * The bridge must surface that (and hard IPC errors) as a rejection so the approval card
 * resets instead of being stuck "submitting" forever.
 */

import type { ToolApprovalMatch } from '@renderer/pages/home/Messages/Tools/toolResponse'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useToolApprovalBridge } from '../useToolApprovalBridge'

const { respond } = vi.hoisted(() => ({
  respond: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) =>
      route === 'ai.respond_tool_approval' ? respond(input) : Promise.resolve(undefined),
    on: () => () => {}
  }
}))

beforeEach(() => {
  respond.mockReset()
})

const match = { messageId: 'a1', approvalId: 'ap-1', transport: 'mcp' } as ToolApprovalMatch

describe('useToolApprovalBridge', () => {
  it('resolves when main returns { ok: true }', async () => {
    respond.mockResolvedValueOnce({ ok: true })
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(result.current({ match, approved: true })).resolves.toBeUndefined()
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'ap-1', anchorId: 'a1', approved: true, topicId: 'topic-1' })
    )
  })

  it('rejects when main returns { ok: false } so the card can reset', async () => {
    respond.mockResolvedValueOnce({ ok: false })
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(result.current({ match, approved: true })).rejects.toThrow()
  })

  it('rejects when the IPC call itself throws', async () => {
    respond.mockRejectedValueOnce(new Error('ipc boom'))
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(result.current({ match, approved: false })).rejects.toThrow('ipc boom')
  })

  it('preserves nested IPC rejection details', async () => {
    respond.mockRejectedValueOnce({ error: { message: 'approval bridge failed' } })
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(result.current({ match, approved: false })).rejects.toThrow('approval bridge failed')
  })

  it('no-ops without an approvalId', async () => {
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(
      result.current({ match: { messageId: 'a1' } as ToolApprovalMatch, approved: true })
    ).resolves.toBeUndefined()
    expect(respond).not.toHaveBeenCalled()
  })
})

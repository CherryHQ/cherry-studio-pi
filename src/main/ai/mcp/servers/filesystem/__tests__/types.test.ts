import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  spawn: spawnMock
}))

import { runRipgrep } from '../types'

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.kill = vi.fn()
  return child
}

describe('filesystem MCP runRipgrep', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    vi.useRealTimers()
  })

  it('kills ripgrep and returns partial stdout when output exceeds the byte cap', async () => {
    const child = createMockChild()
    spawnMock.mockReturnValue(child)

    const resultPromise = runRipgrep(['--files'], { maxStdoutBytes: 4, timeoutMs: 30_000 })
    child.stdout.emit('data', Buffer.from('abcdef'))

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      stdout: 'abcd',
      exitCode: 0,
      truncated: true
    })
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('kills ripgrep and resolves with partial stdout when the timeout expires', async () => {
    vi.useFakeTimers()
    try {
      const child = createMockChild()
      spawnMock.mockReturnValue(child)

      const resultPromise = runRipgrep(['--files'], { timeoutMs: 10, maxStdoutBytes: 1024 })
      child.stdout.emit('data', Buffer.from('partial\n'))
      await vi.advanceTimersByTimeAsync(10)

      await expect(resultPromise).resolves.toEqual({
        ok: true,
        stdout: 'partial\n',
        exitCode: null,
        truncated: true,
        timedOut: true
      })
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })
})

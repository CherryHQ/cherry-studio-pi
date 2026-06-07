import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

vi.mock('@vscode/ripgrep', () => ({
  rgPath: undefined
}))

vi.mock('..', () => ({
  toAsarUnpackedPath: (filePath: string) => filePath
}))

import { runRipgrep } from '../ripgrep'

type MockChild = EventEmitter & {
  killed: boolean
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.killed = false
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => {
    child.killed = true
    return true
  })
  return child
}

describe('main ripgrep utils', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    vi.useRealTimers()
  })

  it('kills ripgrep and returns partial stdout when stdout exceeds the byte cap', async () => {
    const child = createMockChild()
    spawnMock.mockReturnValue(child)

    const resultPromise = runRipgrep(['--files'], {
      binaryPath: 'rg',
      maxStdoutBytes: 4,
      timeoutMs: 30_000
    })
    child.stdout.emit('data', Buffer.from('abcdef'))

    await expect(resultPromise).resolves.toMatchObject({
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

      const resultPromise = runRipgrep(['--files'], {
        binaryPath: 'rg',
        timeoutMs: 10,
        maxStdoutBytes: 1024
      })
      child.stdout.emit('data', Buffer.from('partial\n'))
      await vi.advanceTimersByTimeAsync(10)

      await expect(resultPromise).resolves.toMatchObject({
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

  it('caps stderr without killing an otherwise healthy ripgrep process', async () => {
    const child = createMockChild()
    spawnMock.mockReturnValue(child)

    const resultPromise = runRipgrep(['--files'], {
      binaryPath: 'rg',
      maxStderrBytes: 4,
      timeoutMs: 30_000
    })
    child.stderr.emit('data', Buffer.from('abcdef'))
    child.stdout.emit('data', Buffer.from('ok\n'))
    child.emit('close', 0, null)

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      stdout: 'ok\n',
      stderr: 'abcd',
      exitCode: 0,
      truncated: true
    })
    expect(child.kill).not.toHaveBeenCalled()
  })
})

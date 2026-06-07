import { spawn } from 'node:child_process'
import fs from 'node:fs'

import { rgPath } from '@vscode/ripgrep'

import { toAsarUnpackedPath } from '.'

export interface RipgrepResult {
  ok: boolean
  stdout: string
  stderr?: string
  output?: string
  exitCode: number | null
  signal?: NodeJS.Signals | null
  truncated?: boolean
  timedOut?: boolean
}

export interface RipgrepRunOptions {
  binaryPath?: string
  cwd?: string
  timeoutMs?: number
  maxStdoutBytes?: number
  maxStderrBytes?: number
}

export const RIPGREP_DEFAULT_TIMEOUT_MS = 30_000
export const RIPGREP_MAX_STDOUT_BYTES = 16 * 1024 * 1024
export const RIPGREP_MAX_STDERR_BYTES = 256 * 1024

export function getRipgrepBinaryPath(): string | null {
  const candidates = [process.env.RIPGREP_PATH, rgPath ? toAsarUnpackedPath(rgPath) : undefined].filter(
    Boolean
  ) as string[]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return 'rg'
}

function toBuffer(chunk: unknown): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
}

export async function runRipgrep(args: string[], options: RipgrepRunOptions = {}): Promise<RipgrepResult> {
  const binaryPath = options.binaryPath ?? getRipgrepBinaryPath()

  if (!binaryPath) {
    return {
      ok: false,
      stdout: '',
      stderr: 'Ripgrep binary not available',
      output: 'Ripgrep binary not available',
      exitCode: null
    }
  }

  return new Promise((resolve) => {
    const child = spawn(binaryPath, args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let stderrTruncated = false
    let settled = false
    const timeoutMs = options.timeoutMs ?? RIPGREP_DEFAULT_TIMEOUT_MS
    const maxStdoutBytes = options.maxStdoutBytes ?? RIPGREP_MAX_STDOUT_BYTES
    const maxStderrBytes = options.maxStderrBytes ?? RIPGREP_MAX_STDERR_BYTES

    const stopProcess = () => {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }

    const settle = (result: RipgrepResult) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resolve(result)
    }

    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            stopProcess()
            settle({
              ok: true,
              stdout,
              stderr,
              output: stdout || stderr,
              exitCode: null,
              truncated: true,
              timedOut: true
            })
          }, timeoutMs)
        : undefined
    timeout?.unref?.()

    child.stdout?.on('data', (chunk) => {
      if (settled) return

      const buffer = toBuffer(chunk)
      const remainingBytes = maxStdoutBytes - stdoutBytes

      if (remainingBytes <= 0) {
        stopProcess()
        settle({
          ok: true,
          stdout,
          stderr,
          output: stdout || stderr,
          exitCode: 0,
          truncated: true
        })
        return
      }

      if (buffer.byteLength > remainingBytes) {
        stdout += buffer.subarray(0, remainingBytes).toString('utf-8')
        stdoutBytes = maxStdoutBytes
        stopProcess()
        settle({
          ok: true,
          stdout,
          stderr,
          output: stdout || stderr,
          exitCode: 0,
          truncated: true
        })
        return
      }

      stdout += buffer.toString('utf-8')
      stdoutBytes += buffer.byteLength
    })

    child.stderr?.on('data', (chunk) => {
      if (settled || stderrTruncated) return

      const buffer = toBuffer(chunk)
      const remainingBytes = maxStderrBytes - stderrBytes

      if (remainingBytes <= 0) {
        stderrTruncated = true
        return
      }

      if (buffer.byteLength > remainingBytes) {
        stderr += buffer.subarray(0, remainingBytes).toString('utf-8')
        stderrBytes = maxStderrBytes
        stderrTruncated = true
        return
      }

      stderr += buffer.toString('utf-8')
      stderrBytes += buffer.byteLength
    })

    child.on('error', (error) => {
      if (settled) return
      settle({ ok: false, stdout, stderr: error.message, output: error.message, exitCode: null })
    })

    child.on('close', (code, signal) => {
      settle({
        ok: true,
        stdout,
        stderr,
        output: stdout || stderr,
        exitCode: code,
        signal,
        truncated: stderrTruncated || undefined
      })
    })
  })
}

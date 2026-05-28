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
}

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

export async function runRipgrep(args: string[]): Promise<RipgrepResult> {
  const binaryPath = getRipgrepBinaryPath()

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
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf-8')
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (error) => {
      resolve({ ok: false, stdout: '', stderr: error.message, output: error.message, exitCode: null })
    })

    child.on('close', (code) => {
      resolve({
        ok: true,
        stdout,
        stderr,
        output: stdout || stderr,
        exitCode: code
      })
    })
  })
}

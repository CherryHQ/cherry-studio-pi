import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function loadInternal() {
  delete require.cache[require.resolve('../before-pack.js')]
  return require('../before-pack.js')._internal
}

describe('before-pack', () => {
  it('builds rtk download script arguments for execFileSync', () => {
    const { buildDownloadRtkArgs } = loadInternal()

    expect(buildDownloadRtkArgs('win32', 'x64')).toEqual([
      path.join(__dirname, '..', 'download-rtk-binaries.js'),
      'win32',
      'x64'
    ])
  })

  it('runs pnpm install through cmd.exe on Windows', () => {
    const { buildPnpmInstallInvocation } = loadInternal()

    expect(buildPnpmInstallInvocation('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm install']
    })
  })

  it('runs pnpm install directly on Unix platforms', () => {
    const { buildPnpmInstallInvocation } = loadInternal()

    expect(buildPnpmInstallInvocation('darwin')).toEqual({ command: 'pnpm', args: ['install'] })
    expect(buildPnpmInstallInvocation('linux')).toEqual({ command: 'pnpm', args: ['install'] })
  })
})

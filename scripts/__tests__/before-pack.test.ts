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

  it('uses pnpm.cmd on Windows without relying on shell lookup', () => {
    const { getPnpmExecutable } = loadInternal()

    expect(getPnpmExecutable('win32')).toBe('pnpm.cmd')
    expect(getPnpmExecutable('darwin')).toBe('pnpm')
    expect(getPnpmExecutable('linux')).toBe('pnpm')
  })
})

import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function loadInternal() {
  delete require.cache[require.resolve('../version.js')]
  return require('../version.js')._internal
}

describe('version script', () => {
  it('parses version bump arguments without executing on import', () => {
    const { parseVersionArgs } = loadInternal()

    expect(parseVersionArgs([])).toEqual({ shouldPush: false, versionType: 'patch' })
    expect(parseVersionArgs(['minor', 'push'])).toEqual({ shouldPush: true, versionType: 'minor' })
  })

  it('rejects unsupported version bump types', () => {
    const { parseVersionArgs } = loadInternal()

    expect(() => parseVersionArgs(['nightly'])).toThrow('Invalid version type')
  })

  it('uses pnpm.cmd on Windows without relying on shell lookup', () => {
    const { getPnpmExecutable } = loadInternal()

    expect(getPnpmExecutable('win32')).toBe('pnpm.cmd')
    expect(getPnpmExecutable('darwin')).toBe('pnpm')
    expect(getPnpmExecutable('linux')).toBe('pnpm')
  })
})

import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function loadInternal() {
  delete require.cache[require.resolve('../win-sign.js')]
  return require('../win-sign.js')._internal
}

describe('win-sign', () => {
  it('builds signtool arguments without shell quoting', () => {
    const { buildSignToolArgs } = loadInternal()

    expect(
      buildSignToolArgs({
        certPath: 'C:\\Program Files\\Cherry Certs\\code sign.pfx',
        csp: 'Microsoft Enhanced RSA and AES Cryptographic Provider',
        keyContainer: 'Cherry Studio Pi Release Key',
        path: 'C:\\Users\\Cherry\\dist\\Cherry Studio Pi Setup.exe',
        timestampUrl: 'http://timestamp.digicert.com'
      })
    ).toEqual([
      'sign',
      '/tr',
      'http://timestamp.digicert.com',
      '/td',
      'sha256',
      '/fd',
      'sha256',
      '/v',
      '/f',
      'C:\\Program Files\\Cherry Certs\\code sign.pfx',
      '/csp',
      'Microsoft Enhanced RSA and AES Cryptographic Provider',
      '/k',
      'Cherry Studio Pi Release Key',
      'C:\\Users\\Cherry\\dist\\Cherry Studio Pi Setup.exe'
    ])
  })
})

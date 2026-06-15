import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function loadInternal() {
  delete require.cache[require.resolve('../notarize.js')]
  return require('../notarize.js')._internal
}

describe('notarize', () => {
  it('uses the electron-builder appId as the notarization bundle id', () => {
    const { readPackagedAppId } = loadInternal()

    expect(readPackagedAppId()).toBe('com.cherryai.cherrystudio-pi')
  })
})

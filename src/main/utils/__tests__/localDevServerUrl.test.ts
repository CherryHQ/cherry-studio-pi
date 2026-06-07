import { describe, expect, it } from 'vitest'

import { isLocalViteDevServerUrl } from '../localDevServerUrl'

describe('isLocalViteDevServerUrl', () => {
  it.each([
    'http://localhost:5173/src/main.tsx',
    'https://localhost:5173/src/main.tsx',
    'http://127.0.0.1:5174/',
    'http://[::1]:5175/'
  ])('allows loopback Vite dev-server URL %s', (url) => {
    expect(isLocalViteDevServerUrl(url)).toBe(true)
  })

  it.each([
    'https://example.com/?next=http://localhost:5173',
    'http://localhost.evil.test:5173/',
    'file://localhost:5173/index.html',
    'http://192.168.1.10:5173/',
    'http://localhost:3000/',
    'not a url'
  ])('rejects non-dev-server URL %s', (url) => {
    expect(isLocalViteDevServerUrl(url)).toBe(false)
  })
})

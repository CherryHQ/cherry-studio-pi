import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeJavaScript: vi.fn(),
  getWindowsByType: vi.fn(),
  showMainWindow: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'WindowManager') {
        return { getWindowsByType: mocks.getWindowsByType }
      }
      if (name === 'MainWindowService') {
        return { showMainWindow: mocks.showMainWindow }
      }
      throw new Error(`Unexpected service: ${name}`)
    })
  }
}))

vi.mock('@main/core/platform', () => ({
  isMac: true
}))

import { isAllowedAppRoute, isSensitiveAgentKey, navigateApp, normalizeAppRoute, sanitizeForAgent } from '../utils'

describe('app capability utils', () => {
  beforeEach(() => {
    mocks.executeJavaScript.mockReset()
    mocks.getWindowsByType.mockReset()
    mocks.showMainWindow.mockReset()
    mocks.getWindowsByType.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: {
          executeJavaScript: mocks.executeJavaScript
        }
      }
    ])
  })

  it('redacts sensitive fields while preserving ordinary values', () => {
    expect(
      sanitizeForAgent({
        apiKey: 'sk-secret',
        'api key': 'sk-secret-with-space',
        authorization: 'Bearer token',
        authToken: {
          value: 'nested secret should not be traversed'
        },
        credentials: {
          username: 'hidden-user',
          password: 'hidden-password'
        },
        db_pass: 'hidden-pass',
        webdavPass: 'hidden-webdav-pass',
        passphrase: 'hidden-passphrase',
        passwd: 'hidden-passwd',
        passcode: 'hidden-passcode',
        accessKeyId: 'ak-example',
        cookieJar: ['session-secret'],
        privateKey: '-----BEGIN PRIVATE KEY-----',
        private_key: '-----BEGIN PRIVATE KEY-----',
        hasPassword: true,
        passage: 'visible passage',
        compass: 'visible compass',
        bypassReason: 'visible bypass reason',
        passengerCount: 3,
        nested: {
          name: 'visible',
          cookie: ''
        }
      })
    ).toEqual({
      apiKey: '[redacted]',
      'api key': '[redacted]',
      authorization: '[redacted]',
      authToken: '[redacted]',
      credentials: '[redacted]',
      db_pass: '[redacted]',
      webdavPass: '[redacted]',
      passphrase: '[redacted]',
      passwd: '[redacted]',
      passcode: '[redacted]',
      accessKeyId: '[redacted]',
      cookieJar: '[redacted]',
      privateKey: '[redacted]',
      private_key: '[redacted]',
      hasPassword: true,
      passage: 'visible passage',
      compass: 'visible compass',
      bypassReason: 'visible bypass reason',
      passengerCount: 3,
      nested: {
        name: 'visible',
        cookie: ''
      }
    })
  })

  it('detects sensitive keys without matching ordinary pass words', () => {
    expect(isSensitiveAgentKey('webdavPass')).toBe(true)
    expect(isSensitiveAgentKey('apiServer.apiKey')).toBe(true)
    expect(isSensitiveAgentKey('serviceAccount.privateKey')).toBe(true)
    expect(isSensitiveAgentKey('db_pass')).toBe(true)
    expect(isSensitiveAgentKey('passage')).toBe(false)
    expect(isSensitiveAgentKey('compass')).toBe(false)
    expect(isSensitiveAgentKey('bypassReason')).toBe(false)
    expect(isSensitiveAgentKey('passengerCount')).toBe(false)
  })

  it('serializes bigint values instead of throwing', () => {
    expect(sanitizeForAgent({ count: 42n })).toEqual({ count: '42' })
  })

  it('replaces circular references instead of throwing', () => {
    const value: Record<string, unknown> = { name: 'root' }
    value.self = value

    expect(sanitizeForAgent(value)).toEqual({
      name: 'root',
      self: '[Circular]'
    })
  })

  it('preserves repeated non-circular object references', () => {
    const shared = { value: 'same' }

    expect(sanitizeForAgent({ first: shared, second: shared })).toEqual({
      first: { value: 'same' },
      second: { value: 'same' }
    })
  })

  it('serializes Map and Set values without dropping their contents', () => {
    expect(
      sanitizeForAgent({
        refs: new Map<string, unknown>([
          ['visible', 'value'],
          ['apiKey', 'sk-secret'],
          ['nested', new Set(['one', 'two'])]
        ])
      })
    ).toEqual({
      refs: {
        __type: 'Map',
        size: 3,
        entries: [
          ['visible', 'value'],
          ['apiKey', '[redacted]'],
          [
            'nested',
            {
              __type: 'Set',
              size: 2,
              values: ['one', 'two']
            }
          ]
        ]
      }
    })
  })

  it('returns JSON-safe values for dates and unsupported values', () => {
    expect(
      sanitizeForAgent({
        updatedAt: new Date('2026-06-06T00:00:00.000Z'),
        missing: undefined,
        list: [undefined, () => 'skip']
      })
    ).toEqual({
      updatedAt: '2026-06-06T00:00:00.000Z',
      list: [null, null]
    })
  })

  it('serializes Error objects into useful agent-safe diagnostics', () => {
    const cause = new Error('socket timeout')
    const error = Object.assign(new Error('sync failed', { cause }), {
      code: 'ETIMEDOUT',
      stack: '/local/path/should/not/leak'
    })

    const sanitized = sanitizeForAgent({ error }) as any

    expect(sanitized.error).toEqual({
      name: 'Error',
      message: 'sync failed',
      cause: {
        name: 'Error',
        message: 'socket timeout'
      },
      code: 'ETIMEDOUT'
    })
    expect(JSON.stringify(sanitized)).not.toContain('should/not/leak')
  })

  it('handles circular Error causes instead of throwing', () => {
    const error = new Error('loop') as Error & { cause?: unknown }
    error.cause = error

    expect(sanitizeForAgent({ error })).toEqual({
      error: {
        name: 'Error',
        message: 'loop',
        cause: '[Circular]'
      }
    })
  })

  it('bounds large values before returning them to agents', () => {
    const sanitized = sanitizeForAgent({
      text: 'x'.repeat(10_000),
      items: Array.from({ length: 205 }, (_, index) => index),
      object: Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`key${index}`, index]))
    }) as any

    expect(sanitized.text).toHaveLength(8_025)
    expect(sanitized.text).toContain('[truncated 2000 chars]')
    expect(sanitized.text).not.toContain('x'.repeat(9_000))
    expect(sanitized.items).toHaveLength(201)
    expect(sanitized.items.at(-1)).toBe('[...truncated 5 items...]')
    expect(Object.keys(sanitized.object)).toHaveLength(201)
    expect(sanitized.object.__truncatedKeys).toBe(5)
  })

  it('bounds Map and Set values before returning them to agents', () => {
    const sanitized = sanitizeForAgent({
      map: new Map(Array.from({ length: 205 }, (_, index) => [`key${index}`, index])),
      set: new Set(Array.from({ length: 205 }, (_, index) => index))
    }) as any

    expect(sanitized.map.size).toBe(205)
    expect(sanitized.map.entries).toHaveLength(200)
    expect(sanitized.map.__truncatedEntries).toBe(5)
    expect(sanitized.set.size).toBe(205)
    expect(sanitized.set.values).toHaveLength(200)
    expect(sanitized.set.__truncatedValues).toBe(5)
  })

  it('does not read object properties beyond the agent key limit', () => {
    const object: Record<string, unknown> = {}
    for (let index = 0; index < 205; index += 1) {
      Object.defineProperty(object, `key${index}`, {
        enumerable: true,
        get: () => {
          if (index >= 200) throw new Error('truncated getter should not be read')
          return index
        }
      })
    }

    const sanitized = sanitizeForAgent({ object }) as any

    expect(Object.keys(sanitized.object)).toHaveLength(201)
    expect(sanitized.object.__truncatedKeys).toBe(5)
    expect(sanitized.object.key199).toBe(199)
  })

  it('keeps a single unreadable object property from breaking the whole result', () => {
    const object: Record<string, unknown> = { ok: true }
    Object.defineProperty(object, 'broken', {
      enumerable: true,
      get: () => {
        throw new Error('getter failed')
      }
    })

    expect(sanitizeForAgent({ object })).toEqual({
      object: {
        ok: true,
        broken: '[Unreadable property]'
      }
    })
  })

  it('bounds deeply nested objects before returning them to agents', () => {
    const root: Record<string, unknown> = {}
    let current = root
    for (let index = 0; index < 10; index += 1) {
      const next: Record<string, unknown> = {}
      current.child = next
      current = next
    }

    expect(JSON.stringify(sanitizeForAgent(root))).toContain('[Object truncated]')
  })

  it('normalizes and validates application routes', () => {
    expect(normalizeAppRoute('settings/data')).toBe('/settings/data')
    expect(normalizeAppRoute('  settings/data  ')).toBe('/settings/data')
    expect(normalizeAppRoute('/agents/session-1')).toBe('/app/agents?sessionId=session-1')
    expect(normalizeAppRoute('/paintings/openai')).toBe('/app/paintings/openai')
    expect(normalizeAppRoute('   ')).toBe('/')
    expect(isAllowedAppRoute('/settings/data')).toBe(true)
    expect(isAllowedAppRoute('/agents/session-1')).toBe(true)
    expect(isAllowedAppRoute('/app/agents')).toBe(true)
    expect(isAllowedAppRoute('/settings-malicious')).toBe(false)
    expect(isAllowedAppRoute('https://example.com')).toBe(false)
  })

  it('navigates the main window and foregrounds it on macOS', async () => {
    mocks.executeJavaScript.mockResolvedValue(undefined)

    await navigateApp('settings/data')

    expect(mocks.executeJavaScript).toHaveBeenCalledWith('window.navigate({ to: "/settings/data" })')
    expect(mocks.showMainWindow).toHaveBeenCalledTimes(1)
  })

  it('times out when the renderer navigation bridge does not settle', async () => {
    vi.useFakeTimers()
    try {
      mocks.executeJavaScript.mockReturnValue(new Promise(() => undefined))

      const promise = navigateApp('/settings/data')
      const assertion = expect(promise).rejects.toThrow('Timed out navigating app route /settings/data after 5000ms')
      await vi.advanceTimersByTimeAsync(5_000)

      await assertion
      expect(mocks.showMainWindow).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

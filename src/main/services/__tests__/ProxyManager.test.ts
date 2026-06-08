import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyNodeProxyFromEnvironment,
  buildNodeProxyEnvironment,
  DEFAULT_NODE_PROXY_BYPASS_RULES,
  getEffectiveProxyBypassRules,
  getNodeProxyConfigFromEnvironment,
  getProxyEnvironment,
  getProxyProtocol,
  ProxyBypassRuleMatcher,
  resolveHttpRequestUrlForProxyBypass
} from '../proxy/nodeProxy'
import { redactProxyValueForLog } from '../proxy/redact'

// Mock lifecycle to allow direct instantiation
vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    _disposables: { dispose: () => void }[] = []
    registerDisposable(disposableOrFn: any) {
      const disposable = typeof disposableOrFn === 'function' ? { dispose: disposableOrFn } : disposableOrFn
      this._disposables.push(disposable)
      return disposable
    }
    registerInterval() {
      return { dispose: () => {} }
    }
  }

  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

describe('ProxyManager - bypass evaluation', () => {
  let matcher: ProxyBypassRuleMatcher

  const updateByPassRules = (rules: string[]) => matcher.updateByPassRules(rules)
  const isByPass = (url: string) => matcher.isByPass(url)
  const expectDefaultBypassRules = (value?: string) => {
    const rules = value?.split(',') ?? []

    expect(rules).toEqual(expect.arrayContaining([...DEFAULT_NODE_PROXY_BYPASS_RULES]))
  }

  beforeEach(() => {
    matcher = new ProxyBypassRuleMatcher()
  })

  it('matches simple hostname patterns', () => {
    updateByPassRules(['foobar.com'])
    expect(isByPass('http://foobar.com')).toBe(true)
    expect(isByPass('http://www.foobar.com')).toBe(false)

    updateByPassRules(['*.foobar.com'])
    expect(isByPass('http://api.foobar.com')).toBe(true)
    expect(isByPass('http://foobar.com')).toBe(true)
    expect(isByPass('http://foobar.org')).toBe(false)

    updateByPassRules(['*foobar.com'])
    expect(isByPass('http://devfoobar.com')).toBe(true)
    expect(isByPass('http://foobar.com')).toBe(true)
    expect(isByPass('http://foobar.company')).toBe(false)
  })

  it('matches hostname patterns with scheme and port qualifiers', () => {
    updateByPassRules(['https://secure.example.com'])
    expect(isByPass('https://secure.example.com')).toBe(true)
    expect(isByPass('https://secure.example.com:443/home')).toBe(true)
    expect(isByPass('http://secure.example.com')).toBe(false)

    updateByPassRules(['https://secure.example.com:8443'])
    expect(isByPass('https://secure.example.com:8443')).toBe(true)
    expect(isByPass('https://secure.example.com')).toBe(false)
    expect(isByPass('https://secure.example.com:443')).toBe(false)

    updateByPassRules(['https://x.*.y.com:99'])
    expect(isByPass('https://x.api.y.com:99')).toBe(true)
    expect(isByPass('https://x.api.y.com')).toBe(false)
    expect(isByPass('http://x.api.y.com:99')).toBe(false)
  })

  it('matches domain suffix patterns with leading dot', () => {
    updateByPassRules(['.example.com'])
    expect(isByPass('https://example.com')).toBe(true)
    expect(isByPass('https://api.example.com')).toBe(true)
    expect(isByPass('https://deep.api.example.com')).toBe(true)
    expect(isByPass('https://example.org')).toBe(false)

    updateByPassRules(['.com'])
    expect(isByPass('https://anything.com')).toBe(true)
    expect(isByPass('https://example.org')).toBe(false)

    updateByPassRules(['http://.google.com'])
    expect(isByPass('http://maps.google.com')).toBe(true)
    expect(isByPass('https://maps.google.com')).toBe(false)
  })

  it('matches IP literals, CIDR ranges, and wildcard IPs', () => {
    updateByPassRules(['127.0.0.1', '[::1]', '192.168.1.0/24', 'fefe:13::abc/33', '192.168.*.*'])

    expect(isByPass('http://127.0.0.1')).toBe(true)
    expect(isByPass('http://[::1]')).toBe(true)
    expect(isByPass('http://192.168.1.55')).toBe(true)
    expect(isByPass('http://192.168.200.200')).toBe(true)
    expect(isByPass('http://192.169.1.1')).toBe(false)
    expect(isByPass('http://[fefe:13::abc]')).toBe(true)
  })

  it('matches CIDR ranges specified with IPv6 prefix lengths', () => {
    updateByPassRules(['[2001:db8::1]', '2001:db8::/32'])

    expect(isByPass('http://[2001:db8::1]')).toBe(true)
    expect(isByPass('http://[2001:db8:0:0:0:0:0:ffff]')).toBe(true)
    expect(isByPass('http://[2001:db9::1]')).toBe(false)
  })

  it('matches local addresses when <local> keyword is provided', () => {
    updateByPassRules(['<local>'])

    expect(isByPass('http://localhost')).toBe(true)
    expect(isByPass('http://127.0.0.1')).toBe(true)
    expect(isByPass('http://[::1]')).toBe(true)
    expect(isByPass('http://nas')).toBe(true)
    expect(isByPass('http://dev.localdomain')).toBe(false)
  })

  it('adds local and private network ranges to effective bypass rules by default', () => {
    updateByPassRules(getEffectiveProxyBypassRules('api.example.com'))

    expect(isByPass('http://localhost')).toBe(true)
    expect(isByPass('http://127.0.0.1')).toBe(true)
    expect(isByPass('http://192.168.1.100:8080/dav')).toBe(true)
    expect(isByPass('http://10.23.45.67')).toBe(true)
    expect(isByPass('http://172.16.10.20')).toBe(true)
    expect(isByPass('http://172.31.255.255')).toBe(true)
    expect(isByPass('http://172.32.0.1')).toBe(false)
    expect(isByPass('http://nas')).toBe(true)
    expect(isByPass('http://printer.local')).toBe(true)
    expect(isByPass('https://api.example.com')).toBe(true)
  })

  it('resolves request-option URLs before checking proxy bypass rules', () => {
    expect(
      resolveHttpRequestUrlForProxyBypass(
        undefined,
        {
          protocol: 'http:',
          host: '192.168.1.100:8080',
          path: '/dav'
        },
        'https:'
      )
    ).toBe('http://192.168.1.100:8080/dav')

    expect(
      resolveHttpRequestUrlForProxyBypass(
        undefined,
        {
          hostname: 'fe80::1',
          port: 8080,
          path: 'dav'
        },
        'https:'
      )
    ).toBe('https://[fe80::1]:8080/dav')
  })

  it('exports standard HTTP proxy env vars for http proxies', () => {
    const env = buildNodeProxyEnvironment({
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: 'api.example.com'
    })

    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.http_proxy).toBe('http://127.0.0.1:7890')
    expect(env.https_proxy).toBe('http://127.0.0.1:7890')
    expect(env.ALL_PROXY).toBe('http://127.0.0.1:7890')
    expectDefaultBypassRules(env.NO_PROXY)
    expect(env.NO_PROXY?.split(',')).toContain('api.example.com')
    expect(env.no_proxy).toBe(env.NO_PROXY)
  })

  it('exports only socks-compatible env vars for socks proxies', () => {
    const env = buildNodeProxyEnvironment({
      proxyRules: 'socks5://127.0.0.1:6153',
      proxyBypassRules: 'api.example.com'
    })

    expect(env.SOCKS_PROXY).toBe('socks5://127.0.0.1:6153')
    expect(env.socks_proxy).toBe('socks5://127.0.0.1:6153')
    expect(env.ALL_PROXY).toBe('socks5://127.0.0.1:6153')
    expect(env.all_proxy).toBe('socks5://127.0.0.1:6153')
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.http_proxy).toBeUndefined()
    expect(env.https_proxy).toBeUndefined()
    expectDefaultBypassRules(env.NO_PROXY)
    expect(env.NO_PROXY?.split(',')).toContain('api.example.com')
    expect(env.no_proxy).toBe(env.NO_PROXY)
  })

  it('returns empty env when proxy rules are missing', () => {
    expect(buildNodeProxyEnvironment({})).toEqual({})
  })

  it('exports default no_proxy env vars when user bypass rules are missing', () => {
    const env = buildNodeProxyEnvironment({
      proxyRules: 'http://127.0.0.1:7890'
    })

    expectDefaultBypassRules(env.NO_PROXY)
    expect(env.no_proxy).toBe(env.NO_PROXY)
  })

  it('returns false when bootstrap env has no proxy rules', () => {
    expect(applyNodeProxyFromEnvironment({})).toBe(false)
  })

  it('returns null for invalid proxy urls when detecting protocol', () => {
    expect(getProxyProtocol('127.0.0.1:7890')).toBe(null)
  })

  it('redacts proxy credentials before values are written to logs', () => {
    expect(redactProxyValueForLog('http://user:secret@proxy.example.com:8080')).toBe(
      'http://<redacted>@proxy.example.com:8080'
    )
    expect(redactProxyValueForLog('socks5://token@127.0.0.1:6153')).toBe('socks5://<redacted>@127.0.0.1:6153')
    expect(redactProxyValueForLog('http=user:secret@proxy.example.com:8080;https=socks5://u:p@10.0.0.2:6153')).toBe(
      'http=<redacted>@proxy.example.com:8080;https=socks5://<redacted>@10.0.0.2:6153'
    )
    expect(redactProxyValueForLog('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
  })

  it('extracts only proxy-related env vars', () => {
    expect(
      getProxyEnvironment({
        HTTP_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: 'localhost',
        PATH: '/usr/bin'
      })
    ).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7890',
      NO_PROXY: 'localhost'
    })
  })

  it('derives proxy config from standard proxy env vars', () => {
    expect(
      getNodeProxyConfigFromEnvironment({
        ALL_PROXY: 'socks5://127.0.0.1:6153',
        NO_PROXY: 'localhost'
      })
    ).toEqual({
      proxyRules: 'socks5://127.0.0.1:6153',
      proxyBypassRules: 'localhost'
    })
  })
})

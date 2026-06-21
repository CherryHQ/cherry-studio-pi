import axios from 'axios'
import { socksDispatcher } from 'fetch-socks'
import http from 'http'
import https from 'https'
import * as ipaddr from 'ipaddr.js'
import { ProxyAgent } from 'proxy-agent'
import { Dispatcher, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

import { redactProxyValueForLog } from './redact'

export const CHERRY_NODE_PROXY_RULES_ENV = 'CHERRY_STUDIO_NODE_PROXY_RULES'
export const CHERRY_NODE_PROXY_BYPASS_RULES_ENV = 'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES'

export const DEFAULT_NODE_PROXY_BYPASS_RULES = [
  '<local>',
  'localhost',
  '127.0.0.1',
  '::1',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  'fc00::/7',
  'fe80::/10',
  '*.local'
] as const

const NODE_PROXY_ENV_KEYS = [
  CHERRY_NODE_PROXY_RULES_ENV,
  CHERRY_NODE_PROXY_BYPASS_RULES_ENV,
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'SOCKS_PROXY',
  'socks_proxy',
  'NO_PROXY',
  'no_proxy',
  'grpc_proxy'
] as const

export interface NodeProxyConfig {
  proxyRules?: string
  proxyBypassRules?: string | string[]
}

interface NodeProxyLogger {
  error?: (message: string, ...data: any[]) => void
  warn?: (message: string, ...data: any[]) => void
}

type HttpRequestCallback = (res: http.IncomingMessage) => void
type HttpRequestMethod = typeof http.request | typeof http.get | typeof https.request | typeof https.get

type HostnameMatchType = 'exact' | 'wildcardSubdomain' | 'generalWildcard'

const enum ProxyBypassRuleType {
  Local = 'local',
  Cidr = 'cidr',
  Ip = 'ip',
  Domain = 'domain'
}

interface ParsedProxyBypassRule {
  type: ProxyBypassRuleType
  matchType: HostnameMatchType
  rule: string
  scheme?: string
  port?: string
  domain?: string
  regex?: RegExp
  cidr?: [ipaddr.IPv4 | ipaddr.IPv6, number]
  ip?: string
}

// This well-known symbol is used by Node.js built-in undici to store the global dispatcher.
// Derived from undici (bundled with Node 22). If undici changes this symbol name in a future
// Node.js release, SOCKS dispatcher save/restore will silently no-op (falls back to original).
// Ref: https://github.com/nodejs/undici/blob/main/lib/global.js
const SOCKS_DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1')
const globalDispatcherRegistry = globalThis as typeof globalThis & Record<symbol, Dispatcher | undefined>

const getDefaultPortForProtocol = (protocol: string): string | null => {
  switch (protocol.toLowerCase()) {
    case 'http:':
      return '80'
    case 'https:':
      return '443'
    default:
      return null
  }
}

const buildWildcardRegex = (pattern: string): RegExp => {
  const escapedSegments = pattern.split('*').map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${escapedSegments.join('.*')}$`, 'i')
}

const isWildcardIp = (value: string): boolean => {
  if (!value.includes('*')) {
    return false
  }

  const replaced = value.replace(/\*/g, '0')
  return ipaddr.isValid(replaced)
}

const matchHostnameRule = (hostname: string, rule: ParsedProxyBypassRule): boolean => {
  const normalizedHostname = hostname.toLowerCase()

  switch (rule.matchType) {
    case 'exact':
      return normalizedHostname === rule.domain
    case 'wildcardSubdomain': {
      const domain = rule.domain
      if (!domain) {
        return false
      }
      return normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`)
    }
    case 'generalWildcard':
      return rule.regex ? rule.regex.test(normalizedHostname) : false
    default:
      return false
  }
}

const parseProxyBypassRule = (rule: string): ParsedProxyBypassRule | null => {
  const trimmedRule = rule.trim()
  if (!trimmedRule) {
    return null
  }

  if (trimmedRule === '<local>') {
    return {
      type: ProxyBypassRuleType.Local,
      matchType: 'exact',
      rule: '<local>'
    }
  }

  let workingRule = trimmedRule
  let scheme: string | undefined
  const schemeMatch = workingRule.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):\/\//)
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase()
    workingRule = workingRule.slice(schemeMatch[0].length)
  }

  if (workingRule.includes('/')) {
    const cleanedCidr = workingRule.replace(/^\[|\]$/g, '')
    if (ipaddr.isValidCIDR(cleanedCidr)) {
      return {
        type: ProxyBypassRuleType.Cidr,
        matchType: 'exact',
        rule: workingRule,
        scheme,
        cidr: ipaddr.parseCIDR(cleanedCidr)
      }
    }
  }

  let port: string | undefined
  const portMatch = workingRule.match(/^(.+?):(\d+)$/)
  if (portMatch) {
    const potentialHost = portMatch[1]
    if (!potentialHost.startsWith('[') || potentialHost.includes(']')) {
      workingRule = potentialHost
      port = portMatch[2]
    }
  }

  const cleanedHost = workingRule.replace(/^\[|\]$/g, '')
  const normalizedHost = cleanedHost.toLowerCase()

  if (!cleanedHost) {
    return null
  }

  if (ipaddr.isValid(cleanedHost)) {
    return {
      type: ProxyBypassRuleType.Ip,
      matchType: 'exact',
      rule: cleanedHost,
      scheme,
      port,
      ip: cleanedHost
    }
  }

  if (isWildcardIp(cleanedHost)) {
    const regexPattern = cleanedHost.replace(/\./g, '\\.').replace(/\*/g, '\\d+')
    return {
      type: ProxyBypassRuleType.Ip,
      matchType: 'generalWildcard',
      rule: cleanedHost,
      scheme,
      port,
      regex: new RegExp(`^${regexPattern}$`)
    }
  }

  if (workingRule.startsWith('*.')) {
    const domain = normalizedHost.slice(2)
    return {
      type: ProxyBypassRuleType.Domain,
      matchType: 'wildcardSubdomain',
      rule: workingRule,
      scheme,
      port,
      domain
    }
  }

  if (workingRule.startsWith('.')) {
    const domain = normalizedHost.slice(1)
    return {
      type: ProxyBypassRuleType.Domain,
      matchType: 'wildcardSubdomain',
      rule: workingRule,
      scheme,
      port,
      domain
    }
  }

  if (workingRule.includes('*')) {
    return {
      type: ProxyBypassRuleType.Domain,
      matchType: 'generalWildcard',
      rule: workingRule,
      scheme,
      port,
      regex: buildWildcardRegex(normalizedHost)
    }
  }

  return {
    type: ProxyBypassRuleType.Domain,
    matchType: 'exact',
    rule: workingRule,
    scheme,
    port,
    domain: normalizedHost
  }
}

const isLocalHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost') {
    return true
  }

  const cleaned = hostname.replace(/^\[|\]$/g, '')
  if (ipaddr.isValid(cleaned)) {
    const parsed = ipaddr.parse(cleaned)
    return parsed.range() === 'loopback'
  }

  return !normalized.includes('.') && !normalized.includes(':')
}

export const normalizeProxyBypassRules = (rules?: string | string[]): string[] => {
  if (Array.isArray(rules)) {
    return rules.map((rule) => rule.trim()).filter((rule) => rule.length > 0)
  }

  return rules
    ? rules
        .split(/[;,]/)
        .map((rule) => rule.trim())
        .filter((rule) => rule.length > 0)
    : []
}

export const getEffectiveProxyBypassRules = (rules?: string | string[]): string[] => {
  const seen = new Set<string>()
  const effectiveRules: string[] = []

  for (const rule of [...DEFAULT_NODE_PROXY_BYPASS_RULES, ...normalizeProxyBypassRules(rules)]) {
    const normalizedRule = rule.trim()
    const key = normalizedRule.toLowerCase()
    if (!normalizedRule || seen.has(key)) {
      continue
    }

    seen.add(key)
    effectiveRules.push(normalizedRule)
  }

  return effectiveRules
}

export const getProxyEnvironment = (env: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const proxyEnv: Record<string, string> = {}

  for (const key of NODE_PROXY_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && value.trim() !== '') {
      proxyEnv[key] = value
    }
  }

  return proxyEnv
}

export const getNodeProxyConfigFromEnvironment = (env: NodeJS.ProcessEnv = process.env): NodeProxyConfig | null => {
  const proxyEnv = getProxyEnvironment(env)
  const proxyRules =
    proxyEnv[CHERRY_NODE_PROXY_RULES_ENV] ||
    proxyEnv.ALL_PROXY ||
    proxyEnv.all_proxy ||
    proxyEnv.SOCKS_PROXY ||
    proxyEnv.socks_proxy ||
    proxyEnv.HTTPS_PROXY ||
    proxyEnv.https_proxy ||
    proxyEnv.HTTP_PROXY ||
    proxyEnv.http_proxy

  if (!proxyRules) {
    return null
  }

  return {
    proxyRules,
    proxyBypassRules: proxyEnv[CHERRY_NODE_PROXY_BYPASS_RULES_ENV] || proxyEnv.NO_PROXY || proxyEnv.no_proxy
  }
}

export const getProxyProtocol = (proxyRules?: string): string | null => {
  if (!proxyRules) {
    return null
  }

  try {
    return new URL(proxyRules).protocol.replace(':', '').toLowerCase()
  } catch {
    return null
  }
}

export const isSocksProxyProtocol = (protocol: string | null): boolean => {
  return protocol !== null && protocol.startsWith('socks')
}

export class ProxyBypassRuleMatcher {
  private parsedByPassRules: ParsedProxyBypassRule[] = []

  updateByPassRules(rules: string[], logger?: NodeProxyLogger): void {
    this.parsedByPassRules = []

    for (const rule of rules) {
      const parsedRule = parseProxyBypassRule(rule)
      if (parsedRule) {
        this.parsedByPassRules.push(parsedRule)
      } else {
        logger?.warn?.(`Skipping invalid proxy bypass rule: ${rule}`)
      }
    }
  }

  isByPass(url: string, logger?: NodeProxyLogger) {
    if (this.parsedByPassRules.length === 0) {
      return false
    }

    try {
      const parsedUrl = new URL(url)
      const hostname = parsedUrl.hostname
      const cleanedHostname = hostname.replace(/^\[|\]$/g, '')
      const protocol = parsedUrl.protocol
      const protocolName = protocol.replace(':', '').toLowerCase()
      const defaultPort = getDefaultPortForProtocol(protocol)
      const port = parsedUrl.port || defaultPort || ''
      const hostnameIsIp = ipaddr.isValid(cleanedHostname)

      for (const rule of this.parsedByPassRules) {
        if (rule.scheme && rule.scheme !== protocolName) {
          continue
        }

        if (rule.port && rule.port !== port) {
          continue
        }

        switch (rule.type) {
          case ProxyBypassRuleType.Local:
            if (isLocalHostname(hostname)) {
              return true
            }
            break
          case ProxyBypassRuleType.Ip:
            if (!hostnameIsIp) {
              break
            }

            if (rule.ip && cleanedHostname === rule.ip) {
              return true
            }

            if (rule.regex && rule.regex.test(cleanedHostname)) {
              return true
            }
            break
          case ProxyBypassRuleType.Cidr:
            if (hostnameIsIp && rule.cidr) {
              const parsedHost = ipaddr.parse(cleanedHostname)
              const [cidrAddress, prefixLength] = rule.cidr
              if (parsedHost.kind() === cidrAddress.kind() && parsedHost.match([cidrAddress, prefixLength])) {
                return true
              }
            }
            break
          case ProxyBypassRuleType.Domain:
            if (!hostnameIsIp && matchHostnameRule(hostname, rule)) {
              return true
            }
            break
          default:
            logger?.error?.(`Unknown proxy bypass rule type: ${rule.type}`)
            break
        }
      }
    } catch (error) {
      logger?.error?.('Failed to check bypass:', error as Error)
      return false
    }

    return false
  }
}

export const buildNodeProxyEnvironment = (config: NodeProxyConfig): Record<string, string> => {
  const proxyUrl = config.proxyRules?.trim()
  if (!proxyUrl) {
    return {}
  }

  const normalizedByPassRules = getEffectiveProxyBypassRules(config.proxyBypassRules)
  const proxyProtocol = getProxyProtocol(proxyUrl)
  const env: Record<string, string> = {
    [CHERRY_NODE_PROXY_RULES_ENV]: proxyUrl,
    [CHERRY_NODE_PROXY_BYPASS_RULES_ENV]: normalizedByPassRules.join(',')
  }

  if (normalizedByPassRules.length > 0) {
    env.NO_PROXY = normalizedByPassRules.join(',')
    env.no_proxy = normalizedByPassRules.join(',')
  }

  if (isSocksProxyProtocol(proxyProtocol)) {
    env.SOCKS_PROXY = proxyUrl
    env.socks_proxy = proxyUrl
    env.ALL_PROXY = proxyUrl
    env.all_proxy = proxyUrl
    return env
  }

  env.grpc_proxy = proxyUrl
  env.HTTP_PROXY = proxyUrl
  env.HTTPS_PROXY = proxyUrl
  env.http_proxy = proxyUrl
  env.https_proxy = proxyUrl
  env.ALL_PROXY = proxyUrl
  env.all_proxy = proxyUrl

  return env
}

const normalizeRequestProtocol = (protocol: unknown, defaultProtocol: 'http:' | 'https:'): 'http:' | 'https:' => {
  if (typeof protocol !== 'string' || protocol.trim() === '') {
    return defaultProtocol
  }

  const normalizedProtocol = protocol.trim().toLowerCase()
  if (normalizedProtocol === 'https' || normalizedProtocol === 'https:') {
    return 'https:'
  }

  return 'http:'
}

const getRequestOptionValue = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }

  if (typeof value === 'number') {
    return String(value)
  }

  return undefined
}

const splitHostAndPort = (host: string): { hostname: string; port?: string } => {
  if (host.startsWith('[')) {
    const ipv6Match = host.match(/^\[([^\]]+)\](?::(\d+))?$/)
    if (ipv6Match) {
      return {
        hostname: ipv6Match[1],
        port: ipv6Match[2]
      }
    }

    return { hostname: host.replace(/^\[|\]$/g, '') }
  }

  const lastColonIndex = host.lastIndexOf(':')
  if (lastColonIndex > -1 && !host.slice(0, lastColonIndex).includes(':')) {
    const hostname = host.slice(0, lastColonIndex)
    const port = host.slice(lastColonIndex + 1)
    if (hostname && /^\d+$/.test(port)) {
      return { hostname, port }
    }
  }

  return { hostname: host }
}

const formatHostnameForUrl = (hostname: string): string => {
  const cleanedHostname = hostname.replace(/^\[|\]$/g, '')
  if (ipaddr.isValid(cleanedHostname) && ipaddr.parse(cleanedHostname).kind() === 'ipv6') {
    return `[${cleanedHostname}]`
  }

  return cleanedHostname
}

export const resolveHttpRequestUrlForProxyBypass = (
  url: string | URL | undefined,
  options: http.RequestOptions | https.RequestOptions,
  defaultProtocol: 'http:' | 'https:'
): string | null => {
  try {
    if (url) {
      return url.toString()
    }

    const href = getRequestOptionValue((options as http.RequestOptions & { href?: unknown }).href)
    if (href) {
      return href
    }

    const protocol = normalizeRequestProtocol(options.protocol, defaultProtocol)
    const hostnameOption = getRequestOptionValue(options.hostname)
    const hostOption = getRequestOptionValue(options.host)
    const hostParts = splitHostAndPort(hostnameOption || hostOption || 'localhost')
    const port = getRequestOptionValue(options.port) || hostParts.port
    const pathname = getRequestOptionValue(options.path) || '/'
    const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`
    const formattedHostname = formatHostnameForUrl(hostParts.hostname)
    const formattedPort = port ? `:${port}` : ''

    return `${protocol}//${formattedHostname}${formattedPort}${normalizedPathname}`
  } catch {
    return null
  }
}

class SelectiveDispatcher extends Dispatcher {
  constructor(
    private proxyDispatcher: Dispatcher,
    private directDispatcher: Dispatcher,
    private shouldByPass: (url: string) => boolean,
    private logger?: NodeProxyLogger
  ) {
    super()
  }

  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
    if (opts.origin && this.shouldByPass(opts.origin.toString())) {
      return this.directDispatcher.dispatch(opts, handler)
    }

    return this.proxyDispatcher.dispatch(opts, handler)
  }

  async close(): Promise<void> {
    // Only the proxy dispatcher is owned by this wrapper. The direct dispatcher
    // is a snapshot of the original global dispatcher and must remain intact so
    // NodeProxyController can restore it when proxying is disabled.
    try {
      await this.proxyDispatcher.close()
    } catch (error) {
      this.logger?.error?.('Failed to close dispatcher:', error as Error)
      void this.proxyDispatcher.destroy()
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.proxyDispatcher.destroy()
    } catch (error) {
      this.logger?.error?.('Failed to destroy dispatcher:', error as Error)
    }
  }
}

export class NodeProxyController {
  private proxyDispatcher: Dispatcher | null = null
  private proxyAgent: ProxyAgent | null = null
  private readonly requestTlsProxyAgents = new Map<string, ProxyAgent>()
  private currentConfigKey: string | null = null
  private readonly proxyBypassRuleMatcher = new ProxyBypassRuleMatcher()

  private readonly originalGlobalDispatcher: Dispatcher
  private readonly originalSocksDispatcher: Dispatcher
  private readonly originalHttpGet: typeof http.get
  private readonly originalHttpRequest: typeof http.request
  private readonly originalHttpsGet: typeof https.get
  private readonly originalHttpsRequest: typeof https.request
  private readonly originalAxiosAdapter

  constructor(private logger?: NodeProxyLogger) {
    this.originalGlobalDispatcher = getGlobalDispatcher()
    this.originalSocksDispatcher = globalDispatcherRegistry[SOCKS_DISPATCHER_SYMBOL] ?? this.originalGlobalDispatcher
    this.originalHttpGet = http.get
    this.originalHttpRequest = http.request
    this.originalHttpsGet = https.get
    this.originalHttpsRequest = https.request
    this.originalAxiosAdapter = axios.defaults.adapter
  }

  configure(config: NodeProxyConfig): void {
    const proxyUrl = config.proxyRules?.trim()
    const normalizedByPassRules = getEffectiveProxyBypassRules(config.proxyBypassRules)
    const configKey = JSON.stringify({
      proxyUrl: proxyUrl ?? null,
      proxyByPassRules: normalizedByPassRules
    })

    if (this.currentConfigKey === configKey) {
      return
    }

    this.proxyBypassRuleMatcher.updateByPassRules(normalizedByPassRules, this.logger)
    this.setEnvironment(proxyUrl, normalizedByPassRules)
    this.setGlobalFetchProxy(proxyUrl)
    this.setGlobalHttpProxy(proxyUrl)
    this.currentConfigKey = configKey
  }

  private setEnvironment(url: string | undefined, normalizedByPassRules: string[]): void {
    delete process.env[CHERRY_NODE_PROXY_RULES_ENV]
    delete process.env[CHERRY_NODE_PROXY_BYPASS_RULES_ENV]
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.grpc_proxy
    delete process.env.http_proxy
    delete process.env.https_proxy
    delete process.env.NO_PROXY
    delete process.env.no_proxy
    delete process.env.SOCKS_PROXY
    delete process.env.socks_proxy
    delete process.env.ALL_PROXY
    delete process.env.all_proxy

    if (!url) {
      return
    }

    const env = buildNodeProxyEnvironment({
      proxyRules: url,
      proxyBypassRules: normalizedByPassRules
    })

    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value
    }
  }

  private setGlobalHttpProxy(proxyUrl: string | undefined) {
    if (!proxyUrl) {
      http.get = this.originalHttpGet
      http.request = this.originalHttpRequest
      https.get = this.originalHttpsGet
      https.request = this.originalHttpsRequest

      this.destroyHttpProxyAgents()
      return
    }

    this.destroyHttpProxyAgents()
    const agent = new ProxyAgent()
    this.proxyAgent = agent
    http.get = this.bindHttpMethod(this.originalHttpGet, agent, 'http:')
    http.request = this.bindHttpMethod(this.originalHttpRequest, agent, 'http:')
    https.get = this.bindHttpMethod(this.originalHttpsGet, agent, 'https:')
    https.request = this.bindHttpMethod(this.originalHttpsRequest, agent, 'https:')
  }

  private destroyHttpProxyAgents() {
    const agents = [this.proxyAgent, ...this.requestTlsProxyAgents.values()].filter((agent): agent is ProxyAgent =>
      Boolean(agent)
    )
    this.proxyAgent = null
    this.requestTlsProxyAgents.clear()

    for (const agent of agents) {
      try {
        agent.destroy()
      } catch (error) {
        this.logger?.error?.('Failed to destroy proxy agent:', error as Error)
      }
    }
  }

  private getRequestTlsProxyAgent(rejectUnauthorized: boolean): ProxyAgent {
    const key = `rejectUnauthorized:${rejectUnauthorized}`
    const cached = this.requestTlsProxyAgents.get(key)
    if (cached) return cached

    const agent = new ProxyAgent({ rejectUnauthorized })
    this.requestTlsProxyAgents.set(key, agent)
    return agent
  }

  private resolveProxyAgentForRequest(
    defaultProxyAgent: http.Agent | https.Agent,
    requestAgent: http.RequestOptions['agent']
  ): http.Agent | https.Agent {
    if (requestAgent instanceof https.Agent && typeof requestAgent.options.rejectUnauthorized === 'boolean') {
      return this.getRequestTlsProxyAgent(requestAgent.options.rejectUnauthorized)
    }

    return defaultProxyAgent
  }

  private bindHttpMethod<T extends HttpRequestMethod>(
    originalMethod: T,
    agent: http.Agent | https.Agent,
    defaultProtocol: 'http:' | 'https:'
  ): T {
    const toRequestOptions = (value: unknown): http.RequestOptions | https.RequestOptions =>
      value && typeof value === 'object' ? { ...(value as http.RequestOptions | https.RequestOptions) } : {}
    const callOriginalMethod = (...methodArgs: unknown[]) =>
      (originalMethod as (...args: unknown[]) => http.ClientRequest)(...methodArgs)

    const boundMethod = (...args: unknown[]): http.ClientRequest => {
      let url: string | URL | undefined
      let options: http.RequestOptions | https.RequestOptions
      let callback: HttpRequestCallback | undefined

      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        url = args[0]
        if (typeof args[1] === 'function') {
          options = {}
          callback = args[1] as HttpRequestCallback
        } else {
          options = toRequestOptions(args[1])
          callback = typeof args[2] === 'function' ? (args[2] as HttpRequestCallback) : undefined
        }
      } else {
        options = toRequestOptions(args[0])
        callback = typeof args[1] === 'function' ? (args[1] as HttpRequestCallback) : undefined
      }

      const bypassUrl = resolveHttpRequestUrlForProxyBypass(url, options, defaultProtocol)
      if (bypassUrl && this.proxyBypassRuleMatcher.isByPass(bypassUrl, this.logger)) {
        if (url) {
          return callOriginalMethod(url, options, callback)
        }

        return callOriginalMethod(options, callback)
      }

      options.agent = this.resolveProxyAgentForRequest(agent, options.agent)
      if (url) {
        return callOriginalMethod(url, options, callback)
      }

      return callOriginalMethod(options, callback)
    }

    return boundMethod as T
  }

  private setGlobalFetchProxy(proxyUrl: string | undefined) {
    if (!proxyUrl) {
      setGlobalDispatcher(this.originalGlobalDispatcher)
      globalDispatcherRegistry[SOCKS_DISPATCHER_SYMBOL] = this.originalSocksDispatcher
      void this.proxyDispatcher?.close()
      this.proxyDispatcher = null
      axios.defaults.adapter = this.originalAxiosAdapter
      return
    }

    let url: URL
    try {
      url = new URL(proxyUrl)
    } catch {
      this.logger?.error?.(`Invalid proxy URL: ${redactProxyValueForLog(proxyUrl)}`)
      return
    }

    axios.defaults.adapter = 'fetch'

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      this.proxyDispatcher = new SelectiveDispatcher(
        new EnvHttpProxyAgent(),
        this.originalGlobalDispatcher,
        (origin) => this.proxyBypassRuleMatcher.isByPass(origin, this.logger),
        this.logger
      )
      setGlobalDispatcher(this.proxyDispatcher)
      return
    }

    this.proxyDispatcher = new SelectiveDispatcher(
      socksDispatcher({
        port: parseInt(url.port),
        type: url.protocol === 'socks4:' ? 4 : 5,
        host: url.hostname,
        userId: url.username || undefined,
        password: url.password || undefined
      }),
      this.originalSocksDispatcher,
      (origin) => this.proxyBypassRuleMatcher.isByPass(origin, this.logger),
      this.logger
    )
    setGlobalDispatcher(this.proxyDispatcher)
    globalDispatcherRegistry[SOCKS_DISPATCHER_SYMBOL] = this.proxyDispatcher
  }
}

export const applyNodeProxyFromEnvironment = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const proxyConfig = getNodeProxyConfigFromEnvironment(env)
  if (!proxyConfig) {
    return false
  }

  const controller = new NodeProxyController()
  controller.configure(proxyConfig)

  return true
}

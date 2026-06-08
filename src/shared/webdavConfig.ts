export type WebDavLikeConfig = {
  webdavHost?: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
}

export type ParsedWebDavInput = Required<WebDavLikeConfig> & {
  structured: boolean
}

export type NormalizeWebDavConfigOptions = {
  defaultPath?: string
  requireCredentials?: boolean
}

const DEFAULT_WEBDAV_SYNC_PATH = '/cherry-studio-pi'
const URL_PATTERN = /\b(?:https?|webdav|webdavs):\/\/[^\s"'<>，。；]+/i
const HOST_PATTERN =
  /\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+)(?::\d{1,5})?(?:\/[^\s"'<>，。；]*)?/i
const SINGLE_LABEL_HOST_WITH_PORT_PATTERN = /\b[a-z\d](?:[a-z\d-]*[a-z\d])?:\d{1,5}(?:\/[^\s"'<>，。；]*)?/i
const FIELD_LABEL_PATTERN =
  'webdav\\s*url|webdav\\s*host|server(?:\\s*address)?|sync(?:\\s*directory)?|sync(?:\\s*path)?|username|password|protocol|account|token|host|pass|path|port|user|服务器地址|同步目录|同步路径|服务地址|用户名|服务器|协议|账户|账号|密码|口令|路径|地址|端口|用户'
const ENCODED_LINE_BREAK_PATTERN = /%(?:0d|0a)/i

function readLabeledValue(text: string, labels: string[]) {
  const linePattern = new RegExp(`^\\s*(?:${labels.join('|')})\\s*[:：=]\\s*(.+?)\\s*$`, 'i')
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(linePattern)
    if (match?.[1]) return match[1].trim()
  }

  const inlinePattern = new RegExp(
    `(?:^|[\\s,，;；])(?:${labels.join('|')})\\s*[:：=]\\s*(.+?)(?=(?:[\\s,，;；]+(?:${FIELD_LABEL_PATTERN})\\s*[:：=])|$)`,
    'i'
  )
  const inlineMatch = text.match(inlinePattern)
  if (inlineMatch?.[1]) return inlineMatch[1].trim()

  return ''
}

function hasCredentialLabel(text: string) {
  return /(?:^|[\s,，;；])(账号|账户|用户名|用户|密码|口令|account|username|user|password|pass|token)\s*[:：=]/i.test(
    text
  )
}

function stripStructuredTailFromHost(value: string) {
  const trimmed = value.trim()
  const controlIndex = trimmed.search(/[\r\n]/)
  const encodedLineBreakIndex = trimmed.search(ENCODED_LINE_BREAK_PATTERN)
  const indexes = [controlIndex, encodedLineBreakIndex].filter((index) => index >= 0)

  if (indexes.length === 0) return trimmed
  return trimmed.slice(0, Math.min(...indexes)).trim()
}

function decodeUrlCredential(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeWebDavUrlScheme(value: string) {
  return value.replace(/^webdavs:\/\//i, 'https://').replace(/^webdav:\/\//i, 'http://')
}

export function normalizeWebDavHost(webdavHost?: string) {
  const parsed = parseWebDavInput(webdavHost ?? '')
  const trimmed = stripStructuredTailFromHost(parsed.webdavHost)
  if (!trimmed) return ''
  return normalizeWebDavUrlScheme(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
}

export function normalizeWebDavPath(value?: string, defaultPath = DEFAULT_WEBDAV_SYNC_PATH) {
  const trimmed = value?.trim() || defaultPath
  const parts: string[] = []

  for (const part of trimmed.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return parts.length ? `/${parts.join('/')}` : '/'
}

export function parseWebDavInput(input?: string): ParsedWebDavInput {
  const text = input?.trim() ?? ''
  const structured = /\r?\n/.test(text) || hasCredentialLabel(text)
  if (!text) {
    return {
      webdavHost: '',
      webdavUser: '',
      webdavPass: '',
      webdavPath: '',
      structured
    }
  }

  const protocol = readLabeledValue(text, ['协议', 'protocol'])
  const server = readLabeledValue(text, ['服务器地址', '服务器', '服务地址', '地址', 'server(?:\\s*address)?', 'host'])
  const port = readLabeledValue(text, ['端口', 'port'])
  const endpointPath = readLabeledValue(text, ['路径', 'path'])
  const webdavUser = readLabeledValue(text, ['账号', '账户', '用户名', '用户', 'account', 'username', 'user'])
  const webdavPass = readLabeledValue(text, ['密码', '口令', 'password', 'pass', 'token'])
  const syncPath = readLabeledValue(text, ['同步目录', '同步路径', 'sync(?:\\s*path)?', 'sync(?:\\s*directory)?'])

  let webdavHost = readLabeledValue(text, ['url', 'webdav\\s*url', 'webdav\\s*host'])
  if (!webdavHost) {
    webdavHost = text.match(URL_PATTERN)?.[0] ?? ''
  }
  webdavHost = stripStructuredTailFromHost(webdavHost)

  if (!webdavHost && server) {
    const scheme = protocol && /^[a-z][a-z\d+.-]*$/i.test(protocol) ? protocol : 'https'
    const normalizedServer = server.replace(/^https?:\/\//i, '').replace(/\/+$/g, '')
    const normalizedPort = port && !normalizedServer.includes(':') ? `:${port}` : ''
    const normalizedEndpointPath =
      endpointPath && endpointPath.startsWith('/') ? endpointPath : endpointPath ? `/${endpointPath}` : ''
    webdavHost = `${scheme}://${normalizedServer}${normalizedPort}${normalizedEndpointPath}`
  }

  if (!webdavHost) {
    webdavHost = text.match(HOST_PATTERN)?.[0] ?? text.match(SINGLE_LABEL_HOST_WITH_PORT_PATTERN)?.[0] ?? ''
  }

  return {
    webdavHost,
    webdavUser,
    webdavPass,
    webdavPath: syncPath,
    structured
  }
}

export function normalizeWebDavConfig<T extends WebDavLikeConfig>(
  config: T,
  options: NormalizeWebDavConfigOptions = {}
): T & Required<WebDavLikeConfig> {
  const defaultPath = options.defaultPath ?? DEFAULT_WEBDAV_SYNC_PATH
  const parsedFromHost = parseWebDavInput(config.webdavHost)
  const rawHost = stripStructuredTailFromHost(parsedFromHost.webdavHost || config.webdavHost || '')
  const userFromConfig = config.webdavUser?.trim() ?? ''
  const passFromConfig = config.webdavPass ?? ''
  let webdavUser = userFromConfig || parsedFromHost.webdavUser
  let webdavPass = passFromConfig || parsedFromHost.webdavPass

  if (!rawHost) {
    throw new Error('WebDAV URL 不能为空。请只在 URL 字段填写服务器地址，把用户名和密码分别填到对应字段。')
  }

  const normalizedHost = normalizeWebDavUrlScheme(
    /^[a-z][a-z\d+.-]*:\/\//i.test(rawHost) ? rawHost : `https://${rawHost}`
  )
  let url: URL
  try {
    url = new URL(normalizedHost)
  } catch {
    throw new Error('WebDAV URL 格式不正确。URL 字段只应填写类似 http://192.168.1.100:8080/ 的服务器地址。')
  }

  if (url.username || url.password) {
    webdavUser ||= decodeUrlCredential(url.username)
    webdavPass ||= decodeUrlCredential(url.password)
    url.username = ''
    url.password = ''
  }

  const cleanHost = url.pathname === '/' && !url.search && !url.hash ? url.origin : url.toString()
  if (/\s/.test(cleanHost) || hasCredentialLabel(config.webdavHost ?? '')) {
    const originalHost = config.webdavHost ?? ''
    if (/\s/.test(cleanHost) || (hasCredentialLabel(originalHost) && (!webdavUser || !webdavPass))) {
      throw new Error('WebDAV URL 字段里混入了账号或密码文本。请只填写服务器地址，用户名和密码分别填写到对应字段。')
    }
  }

  if (options.requireCredentials && (!webdavUser || !webdavPass)) {
    throw new Error('WebDAV 用户名和密码不能为空。请确认用户名、密码已分别填写，不要把账号密码整段粘到 URL 字段。')
  }

  return {
    ...config,
    webdavHost: cleanHost,
    webdavUser,
    webdavPass,
    webdavPath: normalizeWebDavPath(parsedFromHost.webdavPath || config.webdavPath, defaultPath)
  }
}

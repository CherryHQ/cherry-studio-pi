import { application } from '@application'
import { loggerService } from '@logger'
import { summarizeTextForLog, summarizeUrlForLog } from '@main/utils/logging'

const logger = loggerService.withContext('ProtocolService:providersImport')
export const PROVIDERS_IMPORT_PROTOCOL_DATA_MAX_CHARS = 64 * 1024

function decodeQueryComponentPreservingPlus(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getProtocolQueryParam(search: string, name: string, maxValueChars = Infinity) {
  const query = search.startsWith('?') ? search.slice(1) : search
  if (!query) return null

  for (const pair of query.split('&')) {
    const separatorIndex = pair.indexOf('=')
    const rawName = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair
    if (decodeQueryComponentPreservingPlus(rawName) !== name) continue

    const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : ''
    if (rawValue.length > maxValueChars) {
      logger.warn('Rejected providers protocol query parameter because it is too large', {
        name,
        length: rawValue.length,
        maxValueChars
      })
      return null
    }
    return decodeQueryComponentPreservingPlus(rawValue)
  }

  return null
}

function normalizeBase64Payload(value: string) {
  return value.replaceAll('_', '+').replaceAll('-', '/')
}

function parseSingleQuotedJsonLiteral(input: string, startIndex: number) {
  let value = ''
  let escaped = false

  for (let index = startIndex + 1; index < input.length; index += 1) {
    const char = input[index]

    if (escaped) {
      switch (char) {
        case "'":
        case '"':
        case '\\':
        case '/':
          value += char
          break
        case 'b':
          value += '\b'
          break
        case 'f':
          value += '\f'
          break
        case 'n':
          value += '\n'
          break
        case 'r':
          value += '\r'
          break
        case 't':
          value += '\t'
          break
        default:
          value += char
          break
      }
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === "'") {
      return {
        json: JSON.stringify(value),
        nextIndex: index + 1
      }
    }

    value += char
  }

  throw new Error('Unterminated single-quoted provider import string')
}

function normalizeLegacyProviderImportPayload(decoded: string) {
  const trimmed = decoded.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null

  const inner = trimmed.slice(1, -1).trim()
  if (!inner.startsWith('{') || !inner.endsWith('}')) return null

  let normalized = ''
  let insideDoubleQuotedString = false
  let escaped = false

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]

    if (insideDoubleQuotedString) {
      normalized += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        insideDoubleQuotedString = false
      }
      continue
    }

    if (char === '"') {
      insideDoubleQuotedString = true
      normalized += char
      continue
    }

    if (char === "'") {
      const literal = parseSingleQuotedJsonLiteral(inner, index)
      normalized += literal.json
      index = literal.nextIndex - 1
      continue
    }

    normalized += char
  }

  return normalized
}

function parseProviderImportPayload(decoded: string) {
  try {
    return JSON.parse(decoded)
  } catch {
    const legacyPayload = normalizeLegacyProviderImportPayload(decoded)
    if (!legacyPayload) throw new Error('Provider import payload is not valid JSON')
    return JSON.parse(legacyPayload)
  }
}

export function parseProvidersImportData(data: string) {
  try {
    if (data.length > PROVIDERS_IMPORT_PROTOCOL_DATA_MAX_CHARS) {
      logger.warn('Rejected providers protocol import payload because it is too large', {
        length: data.length,
        maxValueChars: PROVIDERS_IMPORT_PROTOCOL_DATA_MAX_CHARS
      })
      return null
    }

    const result = parseProviderImportPayload(Buffer.from(normalizeBase64Payload(data), 'base64').toString('utf-8'))

    return JSON.stringify(result)
  } catch (error) {
    logger.error('parseProvidersImportData error:', error as Error)
    return null
  }
}

export async function handleProvidersProtocolUrl(url: URL) {
  switch (url.pathname) {
    case '/api-keys': {
      // jsonConfig example:
      // {
      //   "id": "tokenflux",
      //   "baseUrl": "https://tokenflux.ai/v1",
      //   "apiKey": "sk-xxxx",
      //   "name": "TokenFlux", // optional
      //   "type": "openai" // optional
      // }
      // cherrystudio://providers/api-keys?v=1&data={base64Encode(JSON.stringify(jsonConfig))}

      const rawData = getProtocolQueryParam(url.search, 'data', PROVIDERS_IMPORT_PROTOCOL_DATA_MAX_CHARS)

      if (!rawData) {
        logger.error('handleProvidersProtocolUrl data is null or invalid')
        return
      }

      const data = parseProvidersImportData(rawData)

      if (!data) {
        logger.error('handleProvidersProtocolUrl data is null or invalid')
        return
      }

      const version = getProtocolQueryParam(url.search, 'v')
      if (version == '1') {
        // TODO: handle different version
        logger.debug('handleProvidersProtocolUrl', { data: summarizeTextForLog(data), version })
      }

      application.get('SettingsWindowService').open(`/settings/provider?addProviderData=${encodeURIComponent(data)}`)
      break
    }
    default:
      logger.error('Unknown providers protocol URL', { url: summarizeUrlForLog(url.toString()) })
      break
  }
}

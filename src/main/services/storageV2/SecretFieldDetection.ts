import { STORAGE_V2_SECRET_REF_PREFIX } from './SecretRefIntegrity'

const PROVIDER_AUTH_CONFIG_SECRET_KEY_SET = new Set([
  'accessToken',
  'refreshToken',
  'secretAccessKey',
  'credentials',
  'token',
  'apiKey',
  'privateKey',
  'password',
  'pass',
  'authorization',
  'cookie'
])

const PROVIDER_AUTH_CONFIG_SECRET_KEY_PATTERN =
  /(?:api|private)[-_]?key|(?:access|refresh)[-_]?token|secret|credentials?|tokens?|password|pass|authorization|cookie/i

const SENSITIVE_HEADER_NAME_FRAGMENTS = [
  'authorization',
  'cookie',
  'token',
  'secret',
  'apikey',
  'accesskey',
  'privatekey',
  'credential',
  'credentials',
  'password',
  'pass'
] as const

function normalizeSecretName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function isProviderAuthConfigSecretKey(key: string) {
  return PROVIDER_AUTH_CONFIG_SECRET_KEY_SET.has(key) || PROVIDER_AUTH_CONFIG_SECRET_KEY_PATTERN.test(key)
}

export function isSensitiveHeaderName(headerName: string) {
  const normalized = normalizeSecretName(headerName)
  if (!normalized) return false

  return (
    SENSITIVE_HEADER_NAME_FRAGMENTS.some((fragment) => normalized.includes(fragment)) ||
    (normalized.startsWith('x') && normalized.endsWith('key'))
  )
}

export function isStorageV2SecretRefValue(value: string) {
  return value.trim().startsWith(STORAGE_V2_SECRET_REF_PREFIX)
}

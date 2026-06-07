const SUPPORTED_DATA_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml'
])

const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

export function normalizeDataImageMimeType(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const mimeType = value.split(';', 1)[0]?.trim().toLowerCase()
  if (!mimeType || !SUPPORTED_DATA_IMAGE_MIME_TYPES.has(mimeType)) return null

  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType
}

export function normalizeBase64Payload(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const payload = value.replace(/\s+/g, '')
  if (!payload || !BASE64_PAYLOAD_PATTERN.test(payload)) return null

  return payload
}

export function createDataImageUri(data: unknown, mimeType: unknown): string | null {
  const normalizedMimeType = normalizeDataImageMimeType(mimeType)
  const normalizedData = normalizeBase64Payload(data)

  if (!normalizedMimeType || !normalizedData) return null

  return `data:${normalizedMimeType};base64,${normalizedData}`
}

export function escapeMarkdownImageAlt(value: unknown, fallback = 'Image'): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback

  return text.replace(/([\\[\]])/g, '\\$1').replace(/\r?\n/g, ' ')
}

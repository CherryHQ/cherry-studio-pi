import { describe, expect, it } from 'vitest'

import {
  createDataImageUri,
  escapeMarkdownImageAlt,
  normalizeBase64Payload,
  normalizeDataImageMimeType
} from '../dataImage'

describe('data image utils', () => {
  it('normalizes supported image mime types', () => {
    expect(normalizeDataImageMimeType(' IMAGE/JPG ; charset=utf-8')).toBe('image/jpeg')
    expect(normalizeDataImageMimeType('image/png')).toBe('image/png')
    expect(normalizeDataImageMimeType('text/html')).toBeNull()
    expect(normalizeDataImageMimeType('image/unknown')).toBeNull()
  })

  it('normalizes base64 payloads', () => {
    expect(normalizeBase64Payload('QU JD\nRA==')).toBe('QUJDRA==')
    expect(normalizeBase64Payload('not_base64!')).toBeNull()
    expect(normalizeBase64Payload('')).toBeNull()
  })

  it('creates data image URLs only when mime type and payload are safe', () => {
    expect(createDataImageUri('QUJD', 'image/png')).toBe('data:image/png;base64,QUJD')
    expect(createDataImageUri('PHNjcmlwdD4=', 'text/html')).toBeNull()
    expect(createDataImageUri('not base64?', 'image/png')).toBeNull()
  })

  it('escapes markdown image alt text', () => {
    expect(escapeMarkdownImageAlt('A [lo\ngo]')).toBe('A \\[lo go\\]')
    expect(escapeMarkdownImageAlt('bad](javascript:alert(1))')).toBe('bad\\](javascript:alert(1))')
    expect(escapeMarkdownImageAlt('')).toBe('Image')
  })
})

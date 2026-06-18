import { describe, expect, it } from 'vitest'

import { isAllowedInAppRoute, normalizeInAppRoute } from '../AppRouteNormalizer'

describe('AppRouteNormalizer', () => {
  it('keeps current routes unchanged', () => {
    expect(normalizeInAppRoute('/app/agents')).toBe('/app/agents')
    expect(normalizeInAppRoute('/settings/data')).toBe('/settings/data')
    expect(normalizeInAppRoute('/home')).toBe('/home')
  })

  it('maps legacy top-level app routes to current /app routes', () => {
    expect(normalizeInAppRoute('/agents')).toBe('/app/agents')
    expect(normalizeInAppRoute('/agents/session-1')).toBe('/app/agents?sessionId=session-1')
    expect(normalizeInAppRoute('/agents/session-1?tab=run#bottom')).toBe(
      '/app/agents?tab=run&sessionId=session-1#bottom'
    )
    expect(normalizeInAppRoute('/paintings/openai')).toBe('/app/paintings/openai')
    expect(normalizeInAppRoute('/apps/weather')).toBe('/app/mini-app/weather')
    expect(normalizeInAppRoute('/store')).toBe('/app/library')
  })

  it('allows only normalized in-app routes', () => {
    expect(isAllowedInAppRoute(normalizeInAppRoute('/agents'))).toBe(true)
    expect(isAllowedInAppRoute(normalizeInAppRoute('/settings/data'))).toBe(true)
    expect(isAllowedInAppRoute(normalizeInAppRoute('/agents-legacy'))).toBe(false)
    expect(isAllowedInAppRoute(normalizeInAppRoute('https://example.com'))).toBe(false)
  })

  it('rejects traversal and encoded separators inside otherwise allowed routes', () => {
    expect(isAllowedInAppRoute(normalizeInAppRoute('/paintings/../settings/data'))).toBe(false)
    expect(isAllowedInAppRoute('/app/%2e%2e/settings')).toBe(false)
    expect(isAllowedInAppRoute('/app/%2fsettings')).toBe(false)
    expect(isAllowedInAppRoute('/app/%5csettings')).toBe(false)
    expect(isAllowedInAppRoute('/app/%E0%A4%A')).toBe(false)
  })
})

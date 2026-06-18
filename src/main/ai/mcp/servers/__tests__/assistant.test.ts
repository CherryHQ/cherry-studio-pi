/**
 * Regression for mcp-servers-3: read_source's sensitive-file blocklist must cover all
 * dotenv variants and private-key/cert material, not just `.env`/`.env.local`.
 */

import { describe, expect, it } from 'vitest'

import {
  getAssistantTools,
  isAllowedAssistantNavigationRoute,
  isBlockedSourceFile,
  redactAssistantDiagnosticText
} from '../assistant'

describe('assistant MCP tool metadata', () => {
  it('uses Cherry Studio Pi in agent-facing tool descriptions', () => {
    const descriptions = getAssistantTools()
      .map((tool) => tool.description)
      .join('\n')

    expect(descriptions).toContain('Cherry Studio Pi')
    expect(descriptions).not.toContain('Navigate Cherry Studio to')
    expect(descriptions).not.toContain('Read Cherry Studio runtime state')
  })
})

describe('isAllowedAssistantNavigationRoute', () => {
  it('allows the homepage and documented app route descendants', () => {
    expect(isAllowedAssistantNavigationRoute('/')).toBe(true)
    expect(isAllowedAssistantNavigationRoute('settings/provider')).toBe(true)
    expect(isAllowedAssistantNavigationRoute('/settings/mcp/servers')).toBe(true)
    expect(isAllowedAssistantNavigationRoute('/agents/session-1')).toBe(true)
  })

  it('rejects arbitrary routes and similar-prefix route names', () => {
    expect(isAllowedAssistantNavigationRoute('/admin')).toBe(false)
    expect(isAllowedAssistantNavigationRoute('/agents2')).toBe(false)
    expect(isAllowedAssistantNavigationRoute('/settings-danger')).toBe(false)
    expect(isAllowedAssistantNavigationRoute('/knowledgebase')).toBe(false)
  })
})

describe('isBlockedSourceFile', () => {
  it('blocks every dotenv variant (except the .env.example template)', () => {
    for (const name of ['.env', '.env.local', '.env.production', '.env.development.local', '.ENV', '.Env.Staging']) {
      expect(isBlockedSourceFile(name)).toBe(true)
    }
    expect(isBlockedSourceFile('.env.example')).toBe(false)
  })

  it('blocks credentials and SSH private keys', () => {
    for (const name of ['credentials.json', 'id_rsa', 'id_dsa', 'id_ed25519', 'id_ecdsa']) {
      expect(isBlockedSourceFile(name)).toBe(true)
    }
  })

  it('blocks private-key / cert material by extension (case-insensitive)', () => {
    for (const name of ['server.key', 'cert.pem', 'bundle.p12', 'store.PFX']) {
      expect(isBlockedSourceFile(name)).toBe(true)
    }
  })

  it('allows ordinary source files', () => {
    for (const name of ['index.ts', 'README.md', 'package.json', 'env.ts']) {
      expect(isBlockedSourceFile(name)).toBe(false)
    }
  })
})

describe('redactAssistantDiagnosticText', () => {
  it('redacts common secret shapes before diagnostic logs are sent to the model', () => {
    const redacted = redactAssistantDiagnosticText(
      [
        'apiKey: sk-real-secret',
        'token=ghp_real_secret',
        '"password":"dav-password"',
        "'private_key': 'pem-secret'",
        'Authorization: Bearer bearer-secret',
        'url=https://user:pass@example.com/dav'
      ].join('\n')
    )

    expect(redacted).not.toContain('sk-real-secret')
    expect(redacted).not.toContain('ghp_real_secret')
    expect(redacted).not.toContain('dav-password')
    expect(redacted).not.toContain('pem-secret')
    expect(redacted).not.toContain('bearer-secret')
    expect(redacted).not.toContain('user:pass@')
    expect(redacted).toContain('<redacted>')
    expect(redacted).toContain('https://<redacted>@example.com/dav')
  })

  it('preserves ordinary diagnostic text', () => {
    expect(redactAssistantDiagnosticText('status=ok provider=openai count=3')).toBe('status=ok provider=openai count=3')
  })

  it('preserves ordinary pass and token metric diagnostic fields', () => {
    const redacted = redactAssistantDiagnosticText(
      [
        'compass=north',
        'passage=visible',
        'bypassReason=local network',
        'tokenCount=42',
        'completionTokens=256',
        'webdavPass=dav-secret'
      ].join('\n')
    )

    expect(redacted).toContain('compass=north')
    expect(redacted).toContain('passage=visible')
    expect(redacted).toContain('bypassReason=local network')
    expect(redacted).toContain('tokenCount=42')
    expect(redacted).toContain('completionTokens=256')
    expect(redacted).not.toContain('dav-secret')
    expect(redacted).toContain('webdavPass=<redacted>')
  })
})

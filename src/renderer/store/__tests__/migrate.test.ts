import { afterEach, describe, expect, it, vi } from 'vitest'

import migrate from '../migrate'

describe('store migrations', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  describe('migration 205: local model Anthropic-compatible host backfill', () => {
    it('continues provider host migration when onboarding localStorage marker is blocked', async () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Blocked', 'SecurityError')
      })
      const state = {
        llm: {
          providers: [
            {
              id: 'lmstudio'
            },
            {
              id: 'ollama',
              apiHost: 'http://127.0.0.1:11434'
            }
          ]
        },
        _persist: { version: 204, rehydrated: false }
      }

      const migrated: any = await migrate(state as any, 205)

      expect(migrated.llm.providers[0].anthropicApiHost).toBe('http://localhost:1234')
      expect(migrated.llm.providers[1].anthropicApiHost).toBe('http://127.0.0.1:11434')
    })
  })

  describe('migration 207: StepFun Anthropic-compatible host backfill', () => {
    it('backfills anthropicApiHost for existing StepFun providers', async () => {
      const state = {
        llm: {
          providers: [
            {
              id: 'stepfun',
              apiHost: 'https://api.stepfun.com'
            }
          ]
        },
        _persist: { version: 206, rehydrated: false }
      }

      const migrated: any = await migrate(state as any, 207)

      expect(migrated.llm.providers[0].anthropicApiHost).toBe('https://api.stepfun.com')
    })

    it('preserves existing StepFun anthropicApiHost customizations', async () => {
      const state = {
        llm: {
          providers: [
            {
              id: 'stepfun',
              apiHost: 'https://api.stepfun.com',
              anthropicApiHost: 'https://custom.example.com'
            }
          ]
        },
        _persist: { version: 206, rehydrated: false }
      }

      const migrated: any = await migrate(state as any, 207)

      expect(migrated.llm.providers[0].anthropicApiHost).toBe('https://custom.example.com')
    })
  })
})

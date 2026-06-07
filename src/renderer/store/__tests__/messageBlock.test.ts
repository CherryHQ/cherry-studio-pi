import { WEB_SEARCH_SOURCE } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { formatCitationsFromBlock } from '../messageBlock'

describe('formatCitationsFromBlock', () => {
  it('keeps malformed Gemini grounding chunks from throwing', () => {
    const block = {
      response: {
        source: WEB_SEARCH_SOURCE.GEMINI,
        results: { groundingChunks: { unexpected: true } }
      }
    } as any

    expect(() => formatCitationsFromBlock(block)).not.toThrow()
    expect(formatCitationsFromBlock(block)).toEqual([])
  })

  it('keeps non-array provider citation payloads from throwing', () => {
    const arrayBackedSources = [
      WEB_SEARCH_SOURCE.OPENAI_RESPONSE,
      WEB_SEARCH_SOURCE.OPENAI,
      WEB_SEARCH_SOURCE.ANTHROPIC,
      WEB_SEARCH_SOURCE.PERPLEXITY,
      WEB_SEARCH_SOURCE.GROK,
      WEB_SEARCH_SOURCE.OPENROUTER,
      WEB_SEARCH_SOURCE.ZHIPU,
      WEB_SEARCH_SOURCE.HUNYUAN,
      WEB_SEARCH_SOURCE.AISDK
    ]

    for (const source of arrayBackedSources) {
      const block = {
        response: {
          source,
          results: { unexpected: true }
        }
      } as any

      expect(() => formatCitationsFromBlock(block)).not.toThrow()
      expect(formatCitationsFromBlock(block)).toEqual([])
    }
  })

  it('keeps non-array WebSearch citation result lists from throwing', () => {
    const block = {
      response: {
        source: WEB_SEARCH_SOURCE.WEBSEARCH,
        results: { results: { unexpected: true } }
      }
    } as any

    expect(() => formatCitationsFromBlock(block)).not.toThrow()
    expect(formatCitationsFromBlock(block)).toEqual([])
  })

  it('keeps malformed Perplexity citation URLs from throwing', () => {
    const block = {
      response: {
        source: WEB_SEARCH_SOURCE.PERPLEXITY,
        results: ['http://', { url: 'not a url', title: '' }]
      }
    } as any

    expect(() => formatCitationsFromBlock(block)).not.toThrow()
    expect(formatCitationsFromBlock(block)).toMatchObject([
      { url: 'http://', title: 'http://' },
      { url: 'not a url', title: 'not a url' }
    ])
  })

  it('keeps malformed AISDK citation URLs from throwing', () => {
    const block = {
      response: {
        source: WEB_SEARCH_SOURCE.AISDK,
        results: [{ url: 'http://', title: '' }]
      }
    } as any

    expect(() => formatCitationsFromBlock(block)).not.toThrow()
    expect(formatCitationsFromBlock(block)[0]).toMatchObject({
      url: 'http://',
      title: 'http://'
    })
  })

  it('keeps malformed GROK and OpenRouter citation URLs from throwing', () => {
    const providers = [WEB_SEARCH_SOURCE.GROK, WEB_SEARCH_SOURCE.OPENROUTER]

    for (const source of providers) {
      const block = {
        response: {
          source,
          results: [{ url: 'http://', title: '' }]
        }
      } as any

      expect(() => formatCitationsFromBlock(block)).not.toThrow()
      expect(formatCitationsFromBlock(block)[0]).toMatchObject({
        url: 'http://',
        title: 'http://'
      })
    }
  })
})

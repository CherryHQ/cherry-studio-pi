import { WEB_SEARCH_SOURCE } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { formatCitationsFromBlock } from '../messageBlock'

describe('formatCitationsFromBlock', () => {
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

import type { KnowledgeBaseParams, KnowledgeSearchResult } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

const { default: GeneralReranker } = await import('../GeneralReranker')

function createBase(): KnowledgeBaseParams {
  return {
    documentCount: 2,
    rerankApiClient: {
      provider: 'jina',
      baseURL: 'https://api.jina.ai/v1',
      apiKey: 'secret',
      model: 'jina-reranker-v2-base-multilingual'
    }
  } as KnowledgeBaseParams
}

function createSearchResults(): KnowledgeSearchResult[] {
  return [
    {
      pageContent: 'alpha',
      score: 0.1,
      metadata: {}
    },
    {
      pageContent: 'beta',
      score: 0.2,
      metadata: {}
    }
  ] as KnowledgeSearchResult[]
}

describe('GeneralReranker', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('preserves zero relevance scores and bounds upstream requests', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { index: 0, relevance_score: 0 },
            { index: 1, relevance_score: 0.9 }
          ]
        }),
        { status: 200 }
      )
    )

    const reranker = new GeneralReranker(createBase())
    const result = await reranker.rerank('hello', createSearchResults())

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.jina.ai/v1/rerank',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal)
      })
    )
    expect(result.map((item) => item.score)).toEqual([0.9, 0])
  })
})

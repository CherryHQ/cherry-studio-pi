import { beforeEach, describe, expect, it, vi } from 'vitest'

const compatibleModelState = vi.hoisted(() => ({
  chatModels: [] as Array<{ modelId: string; settings: Record<string, any> }>
}))

vi.mock('@ai-sdk/openai-compatible', () => {
  class OpenAICompatibleChatLanguageModel {
    readonly modelId: string
    readonly settings: Record<string, any>

    constructor(modelId: string, settings: Record<string, any>) {
      this.modelId = modelId
      this.settings = settings
      compatibleModelState.chatModels.push({ modelId, settings })
    }
  }

  class OpenAICompatibleImageModel {}

  return {
    OpenAICompatibleChatLanguageModel,
    OpenAICompatibleImageModel
  }
})

import { createCherryIn } from '../cherryin-provider'

describe('createCherryIn', () => {
  beforeEach(() => {
    compatibleModelState.chatModels = []
  })

  const createWrappedFetch = (fetchMock = vi.fn().mockResolvedValue(new Response('{}'))) => {
    const provider = createCherryIn({
      apiKey: 'sk-test',
      fetch: fetchMock
    })

    provider.chat('gpt-4o')

    const model = compatibleModelState.chatModels.at(-1)
    if (!model) {
      throw new Error('Expected CherryIN chat model to be created')
    }

    return {
      fetchMock,
      wrappedFetch: model.settings.fetch as typeof fetchMock
    }
  }

  it('omits tool_choice for empty OpenAI-compatible tool arrays without mutating the caller options', async () => {
    const { fetchMock, wrappedFetch } = createWrappedFetch()
    const requestInit = {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [],
        tools: [],
        tool_choice: 'auto'
      })
    }

    await wrappedFetch('https://open.cherryin.net/v1/chat/completions', requestInit)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const forwardedInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(forwardedInit.body as string)).toEqual({
      model: 'gpt-4o',
      messages: [],
      tools: []
    })
    expect(JSON.parse(requestInit.body)).toEqual({
      model: 'gpt-4o',
      messages: [],
      tools: [],
      tool_choice: 'auto'
    })
  })

  it('passes non-string request bodies through unchanged', async () => {
    const { fetchMock, wrappedFetch } = createWrappedFetch()
    const requestInit = {
      method: 'POST',
      body: new Uint8Array([1, 2, 3])
    }

    await wrappedFetch('https://open.cherryin.net/v1/chat/completions', requestInit)

    expect(fetchMock).toHaveBeenCalledWith('https://open.cherryin.net/v1/chat/completions', requestInit)
  })
})

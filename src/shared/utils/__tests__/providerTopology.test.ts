import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { getProviderHostTopology } from '../providerTopology'

describe('getProviderHostTopology', () => {
  it('recognizes legacy OpenAI and Anthropic host fields during migration', () => {
    const provider = {
      id: 'deepseek',
      apiHost: ' https://api.deepseek.com ',
      anthropicApiHost: ' https://api.deepseek.com/anthropic ',
      endpointConfigs: {}
    } as Provider & { apiHost: string; anthropicApiHost: string }

    expect(getProviderHostTopology(provider)).toEqual({
      primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      primaryBaseUrl: 'https://api.deepseek.com',
      anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
      hasAnthropicEndpoint: true
    })
  })

  it('prefers endpointConfigs over legacy host fields', () => {
    const provider = {
      id: 'custom',
      apiHost: 'https://legacy-openai.example.com',
      anthropicApiHost: 'https://legacy-anthropic.example.com',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://runtime-openai.example.com' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://runtime-anthropic.example.com' }
      }
    } as Provider & { apiHost: string; anthropicApiHost: string }

    expect(getProviderHostTopology(provider)).toMatchObject({
      primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      primaryBaseUrl: 'https://runtime-openai.example.com',
      anthropicBaseUrl: 'https://runtime-anthropic.example.com',
      hasAnthropicEndpoint: true
    })
  })

  it('treats an Anthropic default chat endpoint as an available Anthropic endpoint', () => {
    const provider = {
      id: 'anthropic-proxy',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {}
    } as Provider

    expect(getProviderHostTopology(provider)).toMatchObject({
      primaryEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      hasAnthropicEndpoint: true
    })
  })
})

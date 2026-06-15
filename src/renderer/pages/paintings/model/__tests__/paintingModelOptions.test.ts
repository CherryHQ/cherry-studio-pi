import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { createModelOptionFromModel, getPaintingModelOptions } from '../utils/paintingModelOptions'

function makeImageModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-image-1',
    providerId: 'openai',
    name: 'GPT Image',
    group: 'OpenAI',
    capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
    endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
    supportsStreaming: false,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('paintingModelOptions', () => {
  it('creates options for legacy raw model ids without throwing', () => {
    const model = makeImageModel({
      id: 'legacy-image-model',
      apiModelId: undefined,
      name: ''
    } as unknown as Partial<Model>)

    expect(createModelOptionFromModel(model)).toMatchObject({
      label: 'legacy-image-model',
      value: 'legacy-image-model'
    })
  })

  it('filters provider image models while preserving api model ids as values', () => {
    const image = makeImageModel({ id: 'openai::internal-image', apiModelId: 'gpt-image-1' })
    const chatOnly = makeImageModel({
      id: 'openai::gpt-4o',
      apiModelId: 'gpt-4o',
      capabilities: [],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })

    expect(getPaintingModelOptions('openai', [image, chatOnly])).toMatchObject([
      {
        label: 'GPT Image',
        value: 'gpt-image-1'
      }
    ])
  })
})

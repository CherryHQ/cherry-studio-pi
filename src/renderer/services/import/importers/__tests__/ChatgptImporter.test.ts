import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uuidCounter: 0
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/utils', () => ({
  uuid: vi.fn(() => `id-${++mocks.uuidCounter}`)
}))

import { ChatgptImporter } from '../ChatgptImporter'

describe('ChatgptImporter', () => {
  beforeEach(() => {
    mocks.uuidCounter = 0
  })

  it('imports text from mixed ChatGPT parts without failing on media parts', async () => {
    const importer = new ChatgptImporter()
    const fileContent = JSON.stringify({
      title: 'Mixed export',
      create_time: 1_700_000_000,
      update_time: 1_700_000_100,
      current_node: 'assistant-1',
      mapping: {
        root: {
          id: 'root',
          children: ['user-1']
        },
        'user-1': {
          id: 'user-1',
          parent: 'root',
          children: ['assistant-1'],
          message: {
            id: 'message-user-1',
            author: { role: 'user' },
            create_time: 1_700_000_001,
            content: {
              content_type: 'multimodal_text',
              parts: [
                'Hello',
                { content_type: 'image_asset_pointer', asset_pointer: 'file-service://image.png' },
                { text: 'from object part' },
                42
              ]
            }
          }
        },
        'assistant-1': {
          id: 'assistant-1',
          parent: 'user-1',
          children: [],
          message: {
            id: 'message-assistant-1',
            author: { role: 'assistant' },
            create_time: 1_700_000_002,
            content: {
              content_type: 'text',
              parts: [{ content: 'Answer from object content' }]
            }
          }
        }
      }
    })

    expect(importer.validate(fileContent)).toBe(true)

    const result = await importer.parse(fileContent, 'assistant-id')

    expect(result.topics).toHaveLength(1)
    expect(result.messages).toHaveLength(2)
    expect(result.blocks.map((block) => block.content)).toEqual([
      'Hello\n\nfrom object part',
      'Answer from object content'
    ])
  })

  it('does not validate exports with a null mapping', () => {
    const importer = new ChatgptImporter()

    expect(
      importer.validate(
        JSON.stringify({
          title: 'Broken export',
          create_time: 1_700_000_000,
          mapping: null
        })
      )
    ).toBe(false)
  })
})

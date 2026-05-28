import type { Model } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { extractModelTokenLimitFields, resolveModelTokenLimits } from '../ModelTokenLimitService'

function model(overrides: Partial<Model>): Model {
  return {
    id: 'test-model',
    name: 'test-model',
    provider: 'test',
    group: 'test',
    ...overrides
  }
}

describe('ModelTokenLimitService', () => {
  it('extracts OpenRouter-style context and completion limits', () => {
    expect(
      extractModelTokenLimitFields({
        context_length: 128_000,
        top_provider: {
          max_completion_tokens: 16_384
        }
      })
    ).toEqual({
      context_window: 128_000,
      max_output_tokens: 16_384
    })
  })

  it('extracts GitHub Models-style input and output limits', () => {
    expect(
      extractModelTokenLimitFields({
        limits: {
          max_input_tokens: 64_000,
          max_output_tokens: 8_000
        }
      })
    ).toEqual({
      max_input_tokens: 64_000,
      max_output_tokens: 8_000
    })
  })

  it('ignores zero and null token limits', () => {
    expect(
      extractModelTokenLimitFields({
        context_length: 0,
        max_output: null
      })
    ).toEqual({})
  })

  it('accepts numeric token limits returned as strings', () => {
    expect(
      extractModelTokenLimitFields({
        max_context_length: '200000',
        max_completion_tokens: '64000'
      })
    ).toEqual({
      context_window: 200_000,
      max_output_tokens: 64_000
    })
  })

  it('prefers explicit model metadata over name-based matching', () => {
    const limits = resolveModelTokenLimits(
      model({
        id: 'custom-gemini-alias',
        context_window: 32_000,
        max_output_tokens: 2_000
      })
    )

    expect(limits).toMatchObject({
      contextWindow: 32_000,
      effectiveContextWindow: 32_000,
      maxOutputTokens: 2_000,
      source: 'metadata'
    })
  })

  it('derives total context from input and output metadata when context_window is absent', () => {
    const limits = resolveModelTokenLimits(
      model({
        max_input_tokens: 8_192,
        max_output_tokens: 1_024
      })
    )

    expect(limits).toMatchObject({
      contextWindow: 9_216,
      effectiveContextWindow: 9_216,
      maxInputTokens: 8_192,
      maxOutputTokens: 1_024,
      source: 'metadata'
    })
  })

  it('matches non-standard custom model IDs conservatively', () => {
    const limits = resolveModelTokenLimits(
      model({
        provider: 'custom',
        group: 'Open AI',
        id: 'Pro/OpenAI--GPT_4.1-mini',
        name: 'GPT 4.1 Mini via Custom Provider'
      })
    )

    expect(limits).toMatchObject({
      contextWindow: 128_000,
      effectiveContextWindow: 128_000,
      maxOutputTokens: 16_384,
      source: 'model-id'
    })
  })

  it('uses default context while honoring output-only metadata', () => {
    const limits = resolveModelTokenLimits(
      model({
        id: 'unknown-model',
        max_output_tokens: 12_000
      })
    )

    expect(limits).toMatchObject({
      contextWindow: 128_000,
      effectiveContextWindow: 128_000,
      maxOutputTokens: 12_000,
      source: 'default'
    })
  })
})

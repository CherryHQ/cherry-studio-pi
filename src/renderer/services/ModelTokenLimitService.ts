import type { Model } from '@renderer/types'

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_OUTPUT_RESERVE = 4_096
const HEURISTIC_CONTEXT_WINDOW_CAP = 256_000

type TokenLimitValue = number | string | null | undefined

export type RawModelTokenLimitSource = {
  context_length?: TokenLimitValue
  context_window?: TokenLimitValue
  max_context_length?: TokenLimitValue
  max_input_tokens?: TokenLimitValue
  max_output_tokens?: TokenLimitValue
  max_completion_tokens?: TokenLimitValue
  max_output?: TokenLimitValue
  inputTokenLimit?: TokenLimitValue
  outputTokenLimit?: TokenLimitValue
  top_provider?: {
    context_length?: TokenLimitValue
    max_completion_tokens?: TokenLimitValue
  }
  limits?: {
    max_input_tokens?: TokenLimitValue
    max_output_tokens?: TokenLimitValue
  }
}

export type ModelTokenLimitFields = {
  context_window?: number
  max_input_tokens?: number
  max_output_tokens?: number
}

export type ModelTokenLimitSource = 'metadata' | 'model-id' | 'default'

export type ModelTokenLimits = {
  contextWindow: number
  effectiveContextWindow: number
  maxInputTokens?: number
  maxOutputTokens?: number
  source: ModelTokenLimitSource
}

type ModelContextRule = {
  match: RegExp
  contextWindow: number
  maxOutputTokens?: number
}

const MODEL_CONTEXT_RULES: ModelContextRule[] = [
  { match: /gemini/, contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  { match: /claude/, contextWindow: 200_000, maxOutputTokens: 8_192 },
  { match: /gpt41|gpt5|o3|o4|gpt4o|chatgpt4o/, contextWindow: 128_000, maxOutputTokens: 16_384 },
  {
    match: /deepseek|qwen|kimi|moonshot|minimax|mistral|llama|glm|grok/,
    contextWindow: 128_000,
    maxOutputTokens: 4_096
  }
]

function positiveTokenLimit(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function firstPositiveTokenLimit(values: unknown[]): number | undefined {
  for (const value of values) {
    const limit = positiveTokenLimit(value)
    if (limit) return limit
  }
  return undefined
}

function compactModelText(model?: Model): string {
  return [model?.provider, model?.group, model?.owned_by, model?.id, model?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function extractModelTokenLimitFields(source: object): ModelTokenLimitFields {
  const limits = source as RawModelTokenLimitSource
  const contextWindow = firstPositiveTokenLimit([
    limits.context_window,
    limits.context_length,
    limits.max_context_length,
    limits.top_provider?.context_length
  ])
  const maxInputTokens = firstPositiveTokenLimit([
    limits.max_input_tokens,
    limits.limits?.max_input_tokens,
    limits.inputTokenLimit
  ])
  const maxOutputTokens = firstPositiveTokenLimit([
    limits.max_output_tokens,
    limits.max_completion_tokens,
    limits.limits?.max_output_tokens,
    limits.top_provider?.max_completion_tokens,
    limits.outputTokenLimit,
    limits.max_output
  ])

  return {
    ...(contextWindow ? { context_window: contextWindow } : {}),
    ...(maxInputTokens ? { max_input_tokens: maxInputTokens } : {}),
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {})
  }
}

export function resolveModelTokenLimits(model?: Model): ModelTokenLimits {
  const metadata = (model ?? {}) as RawModelTokenLimitSource
  const metadataContextWindow = positiveTokenLimit(metadata.context_window)
  const maxInputTokens = positiveTokenLimit(metadata.max_input_tokens)
  const metadataMaxOutputTokens = positiveTokenLimit(metadata.max_output_tokens)

  if (metadataContextWindow || maxInputTokens) {
    const contextWindow =
      metadataContextWindow ??
      (maxInputTokens ?? DEFAULT_CONTEXT_WINDOW) + (metadataMaxOutputTokens ?? DEFAULT_OUTPUT_RESERVE)

    return {
      contextWindow,
      effectiveContextWindow: contextWindow,
      ...(maxInputTokens ? { maxInputTokens } : {}),
      ...(metadataMaxOutputTokens ? { maxOutputTokens: metadataMaxOutputTokens } : {}),
      source: 'metadata'
    }
  }

  const modelText = compactModelText(model)
  const rule = MODEL_CONTEXT_RULES.find((item) => item.match.test(modelText))

  if (rule) {
    const maxOutputTokens = metadataMaxOutputTokens ?? rule.maxOutputTokens

    return {
      contextWindow: rule.contextWindow,
      effectiveContextWindow: Math.min(rule.contextWindow, HEURISTIC_CONTEXT_WINDOW_CAP),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      source: 'model-id'
    }
  }

  return {
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    effectiveContextWindow: DEFAULT_CONTEXT_WINDOW,
    ...(metadataMaxOutputTokens ? { maxOutputTokens: metadataMaxOutputTokens } : {}),
    source: 'default'
  }
}

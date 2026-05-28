import fs from 'node:fs/promises'
import path from 'node:path'

import { getModels, getProviders } from '@earendil-works/pi-ai'
import { loggerService } from '@logger'
import type { Model, Provider } from '@types'

const logger = loggerService.withContext('PiModelSpecs')

export type ModelSpecSource = 'direct' | 'github' | 'openrouter' | 'models.dev' | 'litellm' | 'pi-ai' | 'heuristic'

export type ModelSpec = {
  id: string
  provider?: string
  name?: string
  contextWindow: number
  maxInputTokens?: number
  maxOutputTokens?: number
  supportsTools?: boolean
  supportsVision?: boolean
  supportsReasoning?: boolean
  tokenizer?: string
  source: ModelSpecSource
  sourceUrl?: string
  updatedAt: number
}

export type ModelSpecResolution = {
  spec: ModelSpec
  match: 'direct' | 'exact' | 'normalized' | 'contained' | 'heuristic'
  score: number
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const REFRESH_RETRY_MS = 15 * 60 * 1000
const STARTUP_WAIT_MS = 650
const CACHE_FILE_NAME = 'pi-model-specs-cache.json'
const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384
const MIN_CONTEXT_WINDOW = 4_096
const MAX_EFFICIENT_OUTPUT_TOKENS = 16_384

const SOURCES = {
  github: 'https://models.github.ai/catalog/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
  modelsDev: 'https://models.dev/api.json',
  litellm: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
}

type CacheFile = {
  appVersion?: string
  updatedAt: number
  specs: ModelSpec[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object')

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/_/g, ''))
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }
  return undefined
}

const normalizeProvider = (value?: string | null): string | undefined => {
  const raw = value?.trim().toLowerCase()
  if (!raw) return undefined
  if (raw === 'azure' || raw === 'azure-openai' || raw === 'openai-response') return 'openai'
  if (raw === 'google' || raw === 'gemini' || raw === 'vertexai' || raw === 'google-vertex') return 'google'
  if (raw === 'anthropic' || raw === 'vertex-anthropic') return 'anthropic'
  if (raw === 'grok') return 'xai'
  if (raw === 'aws-bedrock' || raw === 'bedrock' || raw === 'bedrock_converse') return 'amazon-bedrock'
  if (raw === 'new-api' || raw === 'gateway' || raw === 'openai-compatible') return undefined
  return raw
}

export const normalizeModelKey = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/^accounts\/[^/]+\/routers\//, '')
    .replace(/[:_@]+/g, '-')
    .replace(/[^a-z0-9./+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/(^[-/]+|[-/]+$)/g, '')
}

const withoutDateSuffix = (value: string): string => {
  return value
    .replace(/[-/.](?:19|20)\d{2}[-/.]?\d{2}[-/.]?\d{2}$/g, '')
    .replace(/[-/.](?:19|20)\d{6}$/g, '')
    .replace(/[-/.](?:19|20)\d{2}[-/.]\d{2}$/g, '')
    .replace(/-latest$/g, '')
}

export const getModelKeyVariants = (modelId: string): string[] => {
  const normalized = normalizeModelKey(modelId)
  const lastSegment = normalized.split('/').filter(Boolean).at(-1) ?? normalized
  const variants = [
    normalized,
    lastSegment,
    withoutDateSuffix(normalized),
    withoutDateSuffix(lastSegment),
    normalized.replace(/^openai\//, ''),
    normalized.replace(/^anthropic\//, ''),
    normalized.replace(/^google\//, ''),
    normalized.replace(/^qwen\//, ''),
    normalized.replace(/^x-ai\//, '')
  ]

  return [...new Set(variants.filter(Boolean))]
}

const getProviderHints = (provider: Provider, modelId: string): Set<string> => {
  const hints = new Set<string>()
  const add = (value?: string | null) => {
    const normalized = normalizeProvider(value)
    if (normalized) hints.add(normalized)
  }

  add(provider.id)
  add(provider.type)
  add(provider.name)
  add(modelId.split('/')[0])

  return hints
}

const directSpecFromModel = (provider: Provider, modelId: string, model?: Model): ModelSpec | undefined => {
  const raw = model as (Model & Record<string, unknown>) | undefined
  if (!raw) return undefined

  const limits = isRecord(raw.limits) ? raw.limits : isRecord(raw.limit) ? raw.limit : undefined
  const contextWindow =
    toNumber(raw.contextWindow) ??
    toNumber(raw.context_window) ??
    toNumber(raw.context_length) ??
    toNumber(limits?.context) ??
    toNumber(limits?.context_window) ??
    toNumber(limits?.max_input_tokens) ??
    toNumber(raw.max_input_tokens) ??
    toNumber(raw.inputTokenLimit)

  const maxInputTokens =
    toNumber(raw.max_input_tokens) ??
    toNumber(raw.inputTokenLimit) ??
    toNumber(limits?.input) ??
    toNumber(limits?.max_input_tokens) ??
    contextWindow

  const maxOutputTokens =
    toNumber(raw.max_output_tokens) ??
    toNumber(raw.outputTokenLimit) ??
    toNumber(raw.maxOutputTokens) ??
    toNumber(limits?.output) ??
    toNumber(limits?.max_output_tokens)

  if (!contextWindow && !maxInputTokens && !maxOutputTokens) return undefined

  return normalizeSpec({
    id: modelId,
    provider: provider.id,
    name: model?.name,
    contextWindow: contextWindow ?? maxInputTokens ?? DEFAULT_CONTEXT_WINDOW,
    maxInputTokens,
    maxOutputTokens,
    supportsTools: model?.capabilities?.some((capability) => capability.type === 'function_calling'),
    supportsVision: model?.capabilities?.some((capability) => capability.type === 'vision'),
    supportsReasoning: model?.capabilities?.some((capability) => capability.type === 'reasoning'),
    source: 'direct',
    updatedAt: Date.now()
  })
}

const normalizeSpec = (spec: ModelSpec): ModelSpec => {
  const contextWindow = Math.max(
    MIN_CONTEXT_WINDOW,
    spec.contextWindow || spec.maxInputTokens || DEFAULT_CONTEXT_WINDOW
  )
  const maxOutputTokens = spec.maxOutputTokens ? Math.max(1, spec.maxOutputTokens) : undefined
  return {
    ...spec,
    contextWindow,
    maxInputTokens: spec.maxInputTokens ?? contextWindow,
    maxOutputTokens
  }
}

const sourceRank: Record<ModelSpecSource, number> = {
  direct: 100,
  github: 90,
  openrouter: 80,
  'models.dev': 70,
  litellm: 60,
  'pi-ai': 50,
  heuristic: 10
}

const providerMatchScore = (spec: ModelSpec, hints: Set<string>) => {
  const provider = normalizeProvider(spec.provider)
  if (provider && hints.has(provider)) return 16

  const prefix = normalizeProvider(spec.id.split('/')[0])
  if (prefix && hints.has(prefix)) return 12

  return 0
}

const chooseBestSpec = (specs: ModelSpec[], hints: Set<string>): ModelSpec | undefined => {
  return specs
    .map((spec) => ({
      spec,
      score: providerMatchScore(spec, hints) + sourceRank[spec.source] + normalizeModelKey(spec.id).length / 100
    }))
    .sort((a, b) => b.score - a.score)[0]?.spec
}

const specFromHeuristics = (provider: Provider, modelId: string): ModelSpec => {
  const key = normalizeModelKey(modelId)
  const providerHint = normalizeProvider(provider.id) ?? normalizeProvider(provider.type)

  let contextWindow = DEFAULT_CONTEXT_WINDOW
  let maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS

  if (/gpt-4\.1/.test(key)) {
    contextWindow = 1_047_576
    maxOutputTokens = 32_768
  } else if (/gpt-4o|gpt-4\.5/.test(key)) {
    contextWindow = 128_000
    maxOutputTokens = 16_384
  } else if (/gpt-5|o[134](?:-|$)|o\d-pro/.test(key)) {
    contextWindow = 400_000
    maxOutputTokens = 128_000
  } else if (/claude|anthropic/.test(key) || providerHint === 'anthropic') {
    contextWindow = /(?:opus|sonnet|mythos).*(?:4-6|4\.6|4-7|4\.7)|1m/.test(key) ? 1_000_000 : 200_000
    maxOutputTokens = /3[.-]5|3[.-]7/.test(key) ? 8_192 : 64_000
  } else if (/gemini|learnlm/.test(key) || providerHint === 'google') {
    contextWindow = 1_048_576
    maxOutputTokens = /pro/.test(key) ? 65_536 : 8_192
  } else if (/deepseek/.test(key)) {
    contextWindow = 64_000
    maxOutputTokens = 8_192
  } else if (/qwen|qwq|qvq/.test(key)) {
    contextWindow = /(?:long|coder|vl|max|plus|turbo)/.test(key) ? 1_000_000 : 128_000
    maxOutputTokens = 16_384
  } else if (/llama|mistral|mixtral|codestral|magistral/.test(key)) {
    contextWindow = /(?:large|nemo|4|long|codestral|magistral)/.test(key) ? 128_000 : 32_000
    maxOutputTokens = 8_192
  }

  return normalizeSpec({
    id: modelId,
    provider: provider.id,
    contextWindow,
    maxInputTokens: contextWindow,
    maxOutputTokens,
    source: 'heuristic',
    updatedAt: Date.now()
  })
}

const efficientOutputCap = (maxOutputTokens?: number) => {
  if (!maxOutputTokens) return DEFAULT_MAX_OUTPUT_TOKENS
  return Math.max(1_024, Math.min(maxOutputTokens, MAX_EFFICIENT_OUTPUT_TOKENS))
}

const fetchJson = async (url: string, timeoutMs = 10_000): Promise<unknown> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const { net } = await import('electron')
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

const loadPiAiSpecs = (): ModelSpec[] => {
  const updatedAt = Date.now()
  const specs: ModelSpec[] = []
  for (const provider of getProviders()) {
    for (const model of getModels(provider as any)) {
      specs.push(
        normalizeSpec({
          id: model.id,
          provider: model.provider,
          name: model.name,
          contextWindow: model.contextWindow,
          maxInputTokens: model.contextWindow,
          maxOutputTokens: model.maxTokens,
          supportsReasoning: model.reasoning,
          supportsVision: model.input.includes('image'),
          source: 'pi-ai',
          updatedAt
        })
      )
    }
  }
  return specs
}

const parseGithubSpecs = (data: unknown): ModelSpec[] => {
  if (!Array.isArray(data)) return []
  const updatedAt = Date.now()
  return data
    .map((item): ModelSpec | undefined => {
      if (!isRecord(item) || typeof item.id !== 'string') return undefined
      const limits = isRecord(item.limits) ? item.limits : undefined
      const contextWindow = toNumber(limits?.max_input_tokens)
      if (!contextWindow) return undefined
      const inputModalities = Array.isArray(item.supported_input_modalities) ? item.supported_input_modalities : []
      const capabilities = Array.isArray(item.capabilities) ? item.capabilities : []
      return normalizeSpec({
        id: item.id,
        provider: 'github',
        name: typeof item.name === 'string' ? item.name : undefined,
        contextWindow,
        maxInputTokens: contextWindow,
        maxOutputTokens: toNumber(limits?.max_output_tokens),
        supportsTools: capabilities.includes('tool-calling'),
        supportsVision: inputModalities.includes('image'),
        source: 'github',
        sourceUrl: SOURCES.github,
        updatedAt
      })
    })
    .filter((spec): spec is ModelSpec => Boolean(spec))
}

const parseOpenRouterSpecs = (data: unknown): ModelSpec[] => {
  const models = isRecord(data) && Array.isArray(data.data) ? data.data : []
  const updatedAt = Date.now()
  return models
    .map((item): ModelSpec | undefined => {
      if (!isRecord(item) || typeof item.id !== 'string') return undefined
      const topProvider = isRecord(item.top_provider) ? item.top_provider : undefined
      const architecture = isRecord(item.architecture) ? item.architecture : undefined
      const contextWindow = toNumber(topProvider?.context_length) ?? toNumber(item.context_length)
      if (!contextWindow) return undefined
      const inputModalities = Array.isArray(architecture?.input_modalities) ? architecture.input_modalities : []
      const supportedParameters = Array.isArray(item.supported_parameters) ? item.supported_parameters : []
      return normalizeSpec({
        id: item.id,
        provider: item.id.split('/')[0],
        name: typeof item.name === 'string' ? item.name : undefined,
        contextWindow,
        maxInputTokens: contextWindow,
        maxOutputTokens: toNumber(topProvider?.max_completion_tokens),
        supportsTools: supportedParameters.includes('tools'),
        supportsVision: inputModalities.includes('image'),
        supportsReasoning:
          supportedParameters.includes('reasoning') || supportedParameters.includes('include_reasoning'),
        tokenizer: typeof architecture?.tokenizer === 'string' ? architecture.tokenizer : undefined,
        source: 'openrouter',
        sourceUrl: SOURCES.openrouter,
        updatedAt
      })
    })
    .filter((spec): spec is ModelSpec => Boolean(spec))
}

const parseModelsDevSpecs = (data: unknown): ModelSpec[] => {
  if (!isRecord(data)) return []
  const updatedAt = Date.now()
  const specs: ModelSpec[] = []

  for (const [providerId, providerValue] of Object.entries(data)) {
    if (!isRecord(providerValue) || !isRecord(providerValue.models)) continue
    for (const modelValue of Object.values(providerValue.models)) {
      if (!isRecord(modelValue) || typeof modelValue.id !== 'string') continue
      const limit = isRecord(modelValue.limit) ? modelValue.limit : undefined
      const contextWindow = toNumber(limit?.context) ?? toNumber(limit?.input)
      if (!contextWindow) continue
      const modalities = isRecord(modelValue.modalities) ? modelValue.modalities : undefined
      const inputModalities = Array.isArray(modalities?.input) ? modalities.input : []
      specs.push(
        normalizeSpec({
          id: modelValue.id,
          provider: providerId,
          name: typeof modelValue.name === 'string' ? modelValue.name : undefined,
          contextWindow,
          maxInputTokens: toNumber(limit?.input) ?? contextWindow,
          maxOutputTokens: toNumber(limit?.output),
          supportsTools: modelValue.tool_call === true,
          supportsVision: inputModalities.includes('image'),
          supportsReasoning: modelValue.reasoning === true,
          source: 'models.dev',
          sourceUrl: SOURCES.modelsDev,
          updatedAt
        })
      )
    }
  }

  return specs
}

const parseLiteLlmSpecs = (data: unknown): ModelSpec[] => {
  if (!isRecord(data)) return []
  const updatedAt = Date.now()
  const specs: ModelSpec[] = []

  for (const [id, value] of Object.entries(data)) {
    if (id === 'sample_spec' || !isRecord(value)) continue
    const contextWindow = toNumber(value.max_input_tokens) ?? toNumber(value.max_tokens)
    if (!contextWindow) continue
    const supportedModalities = Array.isArray(value.supported_modalities) ? value.supported_modalities : []
    specs.push(
      normalizeSpec({
        id,
        provider: typeof value.litellm_provider === 'string' ? value.litellm_provider : undefined,
        contextWindow,
        maxInputTokens: contextWindow,
        maxOutputTokens: toNumber(value.max_output_tokens) ?? toNumber(value.max_tokens),
        supportsTools: value.supports_function_calling === true,
        supportsVision: value.supports_vision === true || supportedModalities.includes('image'),
        supportsReasoning: value.supports_reasoning === true,
        source: 'litellm',
        sourceUrl: SOURCES.litellm,
        updatedAt
      })
    )
  }

  return specs
}

class ModelSpecRegistry {
  private readonly localSpecs = loadPiAiSpecs()
  private specs = this.localSpecs
  private cacheUpdatedAt = 0
  private lastRefreshAttemptAt = 0
  private appVersion?: string
  private refreshPromise?: Promise<void>
  private loadPromise?: Promise<void>
  private cachePath?: string

  async resolve(provider: Provider, modelId: string, model?: Model): Promise<ModelSpecResolution> {
    const direct = directSpecFromModel(provider, modelId, model)
    if (direct) return { spec: direct, match: 'direct', score: 120 }

    await this.ensureLoaded()
    if (this.shouldRefresh()) {
      const refresh = this.refresh()
      if (this.cacheUpdatedAt === 0) {
        await Promise.race([refresh, new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT_MS))])
      }
    }

    const hints = getProviderHints(provider, modelId)
    const variants = getModelKeyVariants(modelId)
    const index = this.buildIndex()

    for (const variant of variants) {
      const exact = index.get(variant)
      const best = exact ? chooseBestSpec(exact, hints) : undefined
      if (best) {
        return { spec: best, match: variant === normalizeModelKey(modelId) ? 'exact' : 'normalized', score: 100 }
      }
    }

    const contained = this.findContainedMatch(variants, hints)
    if (contained) return contained

    return { spec: specFromHeuristics(provider, modelId), match: 'heuristic', score: 10 }
  }

  toPiLimits(spec: ModelSpec): Pick<ModelSpec, 'contextWindow' | 'maxOutputTokens' | 'source' | 'sourceUrl'> & {
    maxTokens: number
  } {
    return {
      contextWindow: spec.contextWindow,
      maxOutputTokens: spec.maxOutputTokens,
      maxTokens: efficientOutputCap(spec.maxOutputTokens),
      source: spec.source,
      sourceUrl: spec.sourceUrl
    }
  }

  private async ensureLoaded() {
    if (!this.loadPromise) {
      this.loadPromise = this.loadCache().catch((error) => {
        logger.debug('Failed to load model spec cache', error as Error)
      })
    }
    await this.loadPromise
  }

  private shouldRefresh() {
    const now = Date.now()
    return now - this.cacheUpdatedAt > CACHE_TTL_MS && now - this.lastRefreshAttemptAt > REFRESH_RETRY_MS
  }

  private async refresh() {
    if (this.refreshPromise) return this.refreshPromise
    this.lastRefreshAttemptAt = Date.now()

    this.refreshPromise = this.fetchAllSources()
      .then(async (remoteSpecs) => {
        if (remoteSpecs.length === 0) return
        this.specs = [...remoteSpecs, ...this.localSpecs]
        this.cacheUpdatedAt = Date.now()
        await this.saveCache()
      })
      .catch((error) => {
        logger.debug('Failed to refresh remote model specs', error as Error)
      })
      .finally(() => {
        this.refreshPromise = undefined
      })

    return this.refreshPromise
  }

  private async fetchAllSources(): Promise<ModelSpec[]> {
    const results = await Promise.allSettled([
      fetchJson(SOURCES.github).then(parseGithubSpecs),
      fetchJson(SOURCES.openrouter).then(parseOpenRouterSpecs),
      fetchJson(SOURCES.modelsDev).then(parseModelsDevSpecs),
      fetchJson(SOURCES.litellm).then(parseLiteLlmSpecs)
    ])

    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  }

  private buildIndex() {
    const index = new Map<string, ModelSpec[]>()

    for (const spec of this.specs) {
      for (const variant of getModelKeyVariants(spec.id)) {
        const entries = index.get(variant) ?? []
        entries.push(spec)
        index.set(variant, entries)
      }
    }

    return index
  }

  private findContainedMatch(variants: string[], hints: Set<string>): ModelSpecResolution | undefined {
    const candidates: Array<{ spec: ModelSpec; score: number }> = []

    for (const variant of variants) {
      if (variant.length < 8) continue
      for (const spec of this.specs) {
        const providerScore = providerMatchScore(spec, hints)
        if (providerScore === 0) continue
        const specKeys = getModelKeyVariants(spec.id)
        const bestSpecKey = specKeys
          .filter((key) => key.length >= 6)
          .sort((a, b) => b.length - a.length)
          .find((key) => variant.includes(key) || key.includes(variant))
        if (!bestSpecKey) continue
        candidates.push({
          spec,
          score: 70 + providerScore + sourceRank[spec.source] / 10 + bestSpecKey.length / 10
        })
      }
    }

    const best = candidates.sort((a, b) => b.score - a.score)[0]
    return best ? { spec: best.spec, match: 'contained', score: best.score } : undefined
  }

  private async getCachePath() {
    if (this.cachePath) return this.cachePath
    const { app } = await import('electron')
    this.appVersion = app.getVersion()
    this.cachePath = path.join(app.getPath('userData'), CACHE_FILE_NAME)
    return this.cachePath
  }

  private async loadCache() {
    const cachePath = await this.getCachePath()
    const raw = await fs.readFile(cachePath, 'utf8').catch(() => undefined)
    if (!raw) return

    const parsed = JSON.parse(raw) as CacheFile
    if (!Array.isArray(parsed.specs)) return

    this.specs = [...parsed.specs.map(normalizeSpec), ...this.localSpecs]
    this.cacheUpdatedAt = parsed.appVersion === this.appVersion ? parsed.updatedAt || 0 : 0
  }

  private async saveCache() {
    const cachePath = await this.getCachePath()
    const payload: CacheFile = {
      appVersion: this.appVersion,
      updatedAt: this.cacheUpdatedAt,
      specs: this.specs.filter((spec) => spec.source !== 'pi-ai' && spec.source !== 'heuristic')
    }
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    await fs.writeFile(cachePath, JSON.stringify(payload), 'utf8')
  }
}

const registry = new ModelSpecRegistry()

export const resolveModelSpec = async (provider: Provider, modelId: string, model?: Model) => {
  return registry.resolve(provider, modelId, model)
}

export const resolvePiModelLimits = async (provider: Provider, modelId: string, model?: Model) => {
  const resolution = await registry.resolve(provider, modelId, model)
  return {
    ...registry.toPiLimits(resolution.spec),
    match: resolution.match,
    score: resolution.score
  }
}

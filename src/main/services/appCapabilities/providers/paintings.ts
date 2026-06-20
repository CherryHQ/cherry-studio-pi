import { readRendererStoreValue } from '../rendererBridge'
import type { AppCapabilityDefinition } from '../types'
import { navigateApp, normalizeBoundedIntegerInput, okResult, sanitizeForAgent } from '../utils'
import { persistSettingValue, readSettingValueForAgent } from './settings'

export const PAINTING_NAMESPACES = [
  'siliconflow_paintings',
  'dmxapi_paintings',
  'tokenflux_paintings',
  'zhipu_paintings',
  'aihubmix_image_generate',
  'aihubmix_image_remix',
  'aihubmix_image_edit',
  'aihubmix_image_upscale',
  'openai_image_generate',
  'openai_image_edit',
  'ovms_paintings',
  'ppio_draw',
  'ppio_edit'
]

const DEFAULT_PAINTING_HISTORY_LIMIT = 50
const MAX_PAINTING_HISTORY_LIMIT = 200
const MAX_PAINTING_PROMPT_CHARS = 500
const MAX_COMPACT_PAINTING_FILES = 20
const MAX_RAW_PAINTING_STRING_CHARS = 2_000
const MAX_RAW_PAINTING_ARRAY_ITEMS = 20
const MAX_RAW_PAINTING_DEPTH = 4
const RENDERER_STORE_FALLBACK_TIMEOUT_MS = 1_000
const PAINTING_PROVIDER_ROUTE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/

function normalizeInputObject(input: unknown) {
  if (input === null || typeof input === 'undefined') return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Painting capability input must be an object')
  return input as Record<string, unknown>
}

function throwIfPaintingSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason.trim())
  throw new Error('Painting capability call aborted')
}

function normalizeListLimit(value: unknown) {
  return normalizeBoundedIntegerInput(value, {
    label: 'Painting history limit',
    defaultValue: DEFAULT_PAINTING_HISTORY_LIMIT,
    min: 1,
    max: MAX_PAINTING_HISTORY_LIMIT
  })
}

function normalizeOffset(value: unknown) {
  return normalizeBoundedIntegerInput(value, {
    label: 'Painting history offset',
    defaultValue: 0,
    min: 0
  })
}

function normalizeOptionalText(value: unknown, label = 'Value') {
  if (typeof value === 'string') return value.trim()
  if (value === null || typeof value === 'undefined') return ''
  throw new Error(`${label} must be a string`)
}

function normalizeRequiredText(value: unknown, label: string) {
  const text = normalizeOptionalText(value, label)
  if (!text) throw new Error(`${label} is required`)
  return text
}

function normalizeProviderRouteSegment(value: unknown, label = 'Painting provider') {
  const provider = normalizeOptionalText(value, label)
  if (!provider) return ''
  if (!PAINTING_PROVIDER_ROUTE_SEGMENT_PATTERN.test(provider)) {
    throw new Error('Painting provider must be a route-safe provider id')
  }
  return provider
}

function normalizePaintingNamespace(value: unknown) {
  const namespace = normalizeOptionalText(value, 'Painting namespace')
  if (!namespace) return ''
  if (!PAINTING_NAMESPACES.includes(namespace)) {
    throw new Error(`Unsupported painting namespace: ${namespace}`)
  }
  return namespace
}

function truncateText(value: unknown, maxChars = MAX_PAINTING_PROMPT_CHARS) {
  if (typeof value !== 'string') return undefined
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...`
}

function truncateRawString(value: string) {
  if (value.length <= MAX_RAW_PAINTING_STRING_CHARS) return value
  return `${value.slice(0, MAX_RAW_PAINTING_STRING_CHARS)}...[truncated ${value.length - MAX_RAW_PAINTING_STRING_CHARS} chars]`
}

function compactRawPaintingValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return truncateRawString(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value !== 'object') return undefined
  if (seen.has(value)) return '[Circular]'
  if (depth >= MAX_RAW_PAINTING_DEPTH) return '[Object truncated]'

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_RAW_PAINTING_ARRAY_ITEMS)
        .map((item) => compactRawPaintingValue(item, depth + 1, seen) ?? null)
      if (value.length > MAX_RAW_PAINTING_ARRAY_ITEMS) {
        items.push(`[...truncated ${value.length - MAX_RAW_PAINTING_ARRAY_ITEMS} items...]`)
      }
      return items
    }

    const output: Record<string, unknown> = {}
    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      const compacted = compactRawPaintingValue(childValue, depth + 1, seen)
      if (compacted !== undefined) output[key] = compacted
    }
    return output
  } finally {
    seen.delete(value)
  }
}

function compactPainting(namespace: string, painting: any, index: number) {
  const files = Array.isArray(painting?.files) ? painting.files : []
  return {
    namespace,
    index,
    id: painting?.id,
    providerId: painting?.providerId,
    model: painting?.model ?? painting?.priceModel,
    status: painting?.status ?? painting?.ppioStatus,
    prompt: truncateText(painting?.prompt),
    negativePrompt: truncateText(painting?.negativePrompt ?? painting?.negative_prompt),
    generationMode: painting?.generationMode,
    size: painting?.size ?? painting?.imageSize ?? painting?.image_size,
    aspectRatio: painting?.aspectRatio ?? painting?.aspect_ratio,
    urlsCount: Array.isArray(painting?.urls) ? painting.urls.length : 0,
    filesCount: files.length,
    filesTruncated: Math.max(0, files.length - MAX_COMPACT_PAINTING_FILES),
    files: files.slice(0, MAX_COMPACT_PAINTING_FILES).map((file: any) => ({
      id: file?.id,
      name: file?.name ?? file?.origin_name,
      type: file?.type,
      ext: file?.ext,
      size: file?.size
    }))
  }
}

function compactRawPainting(namespace: string, painting: any, index: number) {
  const compacted = compactRawPaintingValue(painting, 0, new WeakSet())
  if (compacted && typeof compacted === 'object' && !Array.isArray(compacted)) {
    return { ...(compacted as Record<string, unknown>), namespace, index }
  }
  return { namespace, index, value: compacted }
}

export function listPaintingHistory(paintings: any, input: any) {
  const namespace = normalizePaintingNamespace(input?.namespace)
  const includeRaw = input?.includeRaw === true
  const limit = normalizeListLimit(input?.limit)
  const offset = normalizeOffset(input?.offset)
  const selectedNamespaces = namespace ? [namespace] : PAINTING_NAMESPACES
  const records = selectedNamespaces.flatMap((name) => {
    const list = Array.isArray(paintings?.[name]) ? paintings[name] : []
    return list.map((painting: any, index: number) => ({ namespace: name, painting, index }))
  })
  const page = records.slice(offset, offset + limit)

  return {
    namespace: namespace || undefined,
    total: records.length,
    limit,
    offset,
    nextOffset: offset + limit < records.length ? offset + limit : null,
    compacted: !includeRaw,
    paintings: sanitizeForAgent(
      page.map(({ namespace, painting, index }) =>
        includeRaw ? compactRawPainting(namespace, painting, index) : compactPainting(namespace, painting, index)
      )
    ),
    counts: Object.fromEntries(PAINTING_NAMESPACES.map((name) => [name, paintings?.[name]?.length || 0]))
  }
}

async function readDefaultPaintingProvider(signal?: AbortSignal) {
  throwIfPaintingSignalAborted(signal)
  const provider = await readSettingValueForAgent('defaultPaintingProvider', signal)
  throwIfPaintingSignalAborted(signal)
  return typeof provider === 'string' ? provider.trim() : ''
}

export function createPaintingCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'paintings.providers.list',
      domain: 'paintings',
      kind: 'query',
      title: 'List painting providers',
      description: 'List painting namespaces and the current default painting provider.',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      tags: ['paintings', 'image', 'providers', 'drawing'],
      execute: async (input: unknown, context) => {
        normalizeInputObject(input)
        throwIfPaintingSignalAborted(context.signal)
        const defaultProvider = await readDefaultPaintingProvider(context.signal)
        throwIfPaintingSignalAborted(context.signal)
        return okResult('Painting providers listed', {
          defaultProvider,
          namespaces: PAINTING_NAMESPACES
        })
      }
    },
    {
      id: 'paintings.history.list',
      domain: 'paintings',
      kind: 'query',
      title: 'List painting history',
      description: 'List generated image history from the painting store.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', enum: PAINTING_NAMESPACES, description: 'Optional painting namespace' },
          limit: { type: 'number', default: DEFAULT_PAINTING_HISTORY_LIMIT },
          offset: { type: 'number', default: 0 },
          includeRaw: {
            type: 'boolean',
            default: false,
            description:
              'Return bounded raw painting objects. Defaults to compact summaries to avoid huge image payloads.'
          }
        }
      },
      risk: 'read',
      tags: ['paintings', 'image', 'history'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        normalizePaintingNamespace(inputObject.namespace)
        normalizeListLimit(inputObject.limit)
        normalizeOffset(inputObject.offset)
        throwIfPaintingSignalAborted(context.signal)
        const paintings = await readRendererStoreValue<any>('state.paintings', {
          checkTimeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
          timeoutMs: RENDERER_STORE_FALLBACK_TIMEOUT_MS,
          signal: context.signal
        }).catch((error) => {
          if (context.signal?.aborted) throw error
          return {}
        })
        throwIfPaintingSignalAborted(context.signal)
        return okResult('Painting history listed', listPaintingHistory(paintings, inputObject))
      }
    },
    {
      id: 'paintings.defaultProvider.set',
      domain: 'paintings',
      kind: 'command',
      title: 'Set default painting provider',
      description: 'Set the default painting provider used by the painting page.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Painting provider id such as cherryin, aihubmix, ppio, or openai' }
        },
        required: ['provider']
      },
      risk: 'write',
      permissions: ['paintings.write'],
      sideEffects: ['settings.write'],
      tags: ['paintings', 'settings', 'provider'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const provider = normalizeProviderRouteSegment(inputObject.provider)
        if (!provider) throw new Error('Painting provider is required')
        throwIfPaintingSignalAborted(context.signal)
        await persistSettingValue('defaultPaintingProvider', provider, context.signal)
        throwIfPaintingSignalAborted(context.signal)
        return okResult('Default painting provider updated', { defaultProvider: provider })
      }
    },
    {
      id: 'paintings.open',
      domain: 'paintings',
      kind: 'command',
      title: 'Open painting workspace',
      description: 'Open the painting workspace. Use this when image generation needs human-visible intervention.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Optional provider route segment' }
        }
      },
      risk: 'read',
      tags: ['paintings', 'image', 'drawing', 'open'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const inputProvider = normalizeProviderRouteSegment(inputObject.provider)
        const provider =
          inputProvider || normalizeProviderRouteSegment(await readDefaultPaintingProvider(context.signal))
        const route = provider ? `/paintings/${provider}` : '/paintings'
        throwIfPaintingSignalAborted(context.signal)
        await navigateApp(route)
        throwIfPaintingSignalAborted(context.signal)
        return okResult('Painting workspace opened', { route })
      }
    },
    {
      id: 'paintings.image.generate',
      domain: 'paintings',
      kind: 'command',
      title: 'Generate image',
      description:
        'Generate an image through the app painting workflow. This first runtime version opens the painting workspace and returns a structured request for the UI generation bridge.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Image prompt' },
          provider: { type: 'string', description: 'Optional painting provider' },
          model: { type: 'string', description: 'Optional image model id' },
          size: { type: 'string', description: 'Optional image size such as 1024x1024' }
        },
        required: ['prompt']
      },
      risk: 'external',
      permissions: ['paintings.generate'],
      sideEffects: ['model.call', 'network'],
      tags: ['paintings', 'image', 'generate', 'drawing'],
      execute: async (input: unknown, context) => {
        const inputObject = normalizeInputObject(input)
        const prompt = normalizeRequiredText(inputObject.prompt, 'Painting prompt')
        const inputProvider = normalizeProviderRouteSegment(inputObject.provider)
        const provider =
          inputProvider || normalizeProviderRouteSegment(await readDefaultPaintingProvider(context.signal))
        const model = normalizeOptionalText(inputObject.model, 'Painting model') || undefined
        const size = normalizeOptionalText(inputObject.size, 'Painting size') || undefined
        const route = provider ? `/paintings/${provider}` : '/paintings'
        throwIfPaintingSignalAborted(context.signal)
        await navigateApp(route)
        throwIfPaintingSignalAborted(context.signal)
        return {
          ok: true,
          summary:
            'Painting generation request prepared. The UI generation bridge is not wired yet, so the painting workspace was opened.',
          data: {
            provider,
            route,
            prompt: truncateText(prompt),
            model,
            size
          },
          warnings: ['Direct headless painting generation will be wired in the next provider bridge pass.']
        }
      }
    }
  ]
}

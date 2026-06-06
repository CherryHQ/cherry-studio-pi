import { reduxService } from '@main/services/ReduxService'

import type { AppCapabilityDefinition } from '../types'
import { navigateApp, okResult, sanitizeForAgent } from '../utils'

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
const MAX_RAW_PAINTING_STRING_CHARS = 2_000
const MAX_RAW_PAINTING_ARRAY_ITEMS = 20
const MAX_RAW_PAINTING_DEPTH = 4

function normalizeListLimit(value: unknown) {
  const parsed =
    typeof value === 'string' && !value.trim()
      ? DEFAULT_PAINTING_HISTORY_LIMIT
      : Number(value ?? DEFAULT_PAINTING_HISTORY_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_PAINTING_HISTORY_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_PAINTING_HISTORY_LIMIT))
}

function normalizeOffset(value: unknown) {
  const parsed = typeof value === 'string' && !value.trim() ? 0 : Number(value ?? 0)
  const safeOffset = Number.isFinite(parsed) ? Math.trunc(parsed) : 0
  return Math.max(0, safeOffset)
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
    filesCount: Array.isArray(painting?.files) ? painting.files.length : 0,
    files: Array.isArray(painting?.files)
      ? painting.files.map((file: any) => ({
          id: file?.id,
          name: file?.name ?? file?.origin_name,
          type: file?.type,
          ext: file?.ext,
          size: file?.size
        }))
      : []
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
  const namespace = String(input?.namespace || '').trim()
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
      execute: async () => {
        const settings = await reduxService.select<any>('state.settings')
        return okResult('Painting providers listed', {
          defaultProvider: settings?.defaultPaintingProvider,
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
      execute: async (input: any) => {
        const paintings = await reduxService.select<any>('state.paintings')
        return okResult('Painting history listed', listPaintingHistory(paintings, input))
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
      tags: ['paintings', 'settings', 'provider'],
      execute: async (input: any) => {
        const provider = String(input?.provider ?? '').trim()
        if (!provider) throw new Error('Painting provider is required')
        await reduxService.dispatch({ type: 'settings/setDefaultPaintingProvider', payload: provider })
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
      execute: async (input: any) => {
        const inputProvider = typeof input?.provider === 'string' ? input.provider.trim() : ''
        const settings = inputProvider ? null : await reduxService.select<any>('state.settings')
        const provider =
          inputProvider ||
          (typeof settings?.defaultPaintingProvider === 'string' ? settings.defaultPaintingProvider.trim() : '')
        const route = provider ? `/paintings/${provider}` : '/paintings'
        await navigateApp(route)
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
      execute: async (input: any) => {
        const inputProvider = typeof input?.provider === 'string' ? input.provider.trim() : ''
        const settings = inputProvider ? null : await reduxService.select<any>('state.settings')
        const provider =
          inputProvider ||
          (typeof settings?.defaultPaintingProvider === 'string' ? settings.defaultPaintingProvider.trim() : '')
        const route = provider ? `/paintings/${provider}` : '/paintings'
        await navigateApp(route)
        return {
          ok: true,
          summary:
            'Painting generation request prepared. The UI generation bridge is not wired yet, so the painting workspace was opened.',
          data: {
            provider,
            route,
            prompt: input?.prompt,
            model: input?.model,
            size: input?.size
          },
          warnings: ['Direct headless painting generation will be wired in the next provider bridge pass.']
        }
      }
    }
  ]
}

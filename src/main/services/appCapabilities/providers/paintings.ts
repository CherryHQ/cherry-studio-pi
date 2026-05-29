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
          namespace: { type: 'string', enum: PAINTING_NAMESPACES, description: 'Optional painting namespace' }
        }
      },
      risk: 'read',
      tags: ['paintings', 'image', 'history'],
      execute: async (input: any) => {
        const paintings = await reduxService.select<any>('state.paintings')
        const namespace = String(input?.namespace || '')
        return okResult('Painting history listed', {
          namespace: namespace || undefined,
          paintings: sanitizeForAgent(namespace ? paintings?.[namespace] || [] : paintings),
          counts: Object.fromEntries(PAINTING_NAMESPACES.map((name) => [name, paintings?.[name]?.length || 0]))
        })
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
        await reduxService.dispatch({ type: 'settings/setDefaultPaintingProvider', payload: input?.provider })
        return okResult('Default painting provider updated', { defaultProvider: input?.provider })
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
        const provider = input?.provider || (await reduxService.select<any>('state.settings'))?.defaultPaintingProvider
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
        const provider = input?.provider || (await reduxService.select<any>('state.settings'))?.defaultPaintingProvider
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

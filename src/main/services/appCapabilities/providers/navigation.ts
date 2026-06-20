import type { AppCapabilityDefinition } from '../types'
import { navigateApp, normalizeAppRoute, okResult } from '../utils'

function normalizeNavigationRoute(value: unknown) {
  if (typeof value !== 'string') throw new Error('App route must be a string')

  const route = value.trim()
  if (!route) throw new Error('App route is required')

  return normalizeAppRoute(route)
}

function throwIfNavigationSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason.trim())
  throw new Error('Navigation capability call aborted')
}

export function createNavigationCapabilities(): AppCapabilityDefinition[] {
  return [
    {
      id: 'app.navigate',
      domain: 'app',
      kind: 'command',
      title: 'Navigate application',
      description: 'Navigate the main Cherry Studio Pi window to a safe in-app route.',
      inputSchema: {
        type: 'object',
        properties: {
          route: {
            type: 'string',
            description: 'Route such as /, /settings/data, /knowledge, /paintings, /notes, or /agents'
          }
        },
        required: ['route']
      },
      risk: 'read',
      tags: ['app', 'ui', 'navigation', 'open'],
      execute: async (input: any, context) => {
        const route = normalizeNavigationRoute(input?.route)
        throwIfNavigationSignalAborted(context.signal)
        await (context.signal ? navigateApp(route, context.signal) : navigateApp(route))
        throwIfNavigationSignalAborted(context.signal)
        return okResult('Application navigated', { route })
      }
    }
  ]
}

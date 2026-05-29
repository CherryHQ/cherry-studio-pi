import type { AppCapabilityDefinition } from '../types'
import { navigateApp, okResult } from '../utils'

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
      execute: async (input: any) => {
        const route = String(input?.route || '/')
        await navigateApp(route)
        return okResult('Application navigated', { route })
      }
    }
  ]
}

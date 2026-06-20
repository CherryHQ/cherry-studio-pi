import type { AppCapabilityDefinition } from '../types'
import { navigateApp, normalizeAppRoute, okResult } from '../utils'

const APP_ROUTE_STRING_ERROR = '应用路由必须是字符串。'
const APP_ROUTE_REQUIRED_ERROR = '应用路由不能为空。'
const NAVIGATION_ABORT_ERROR = '导航能力调用已取消。'
const APPLICATION_NAVIGATED_SUMMARY = '应用导航已完成'

function normalizeNavigationRoute(value: unknown) {
  if (typeof value !== 'string') throw new Error(APP_ROUTE_STRING_ERROR)

  const route = value.trim()
  if (!route) throw new Error(APP_ROUTE_REQUIRED_ERROR)

  return normalizeAppRoute(route)
}

function throwIfNavigationSignalAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason.trim())
  throw new Error(NAVIGATION_ABORT_ERROR)
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
        return okResult(APPLICATION_NAVIGATED_SUMMARY, { route })
      }
    }
  ]
}

import path from 'node:path'

import { isMac } from '@main/constant'
import { windowService } from '@main/services/WindowService'
import { isPathInside } from '@main/utils/file'

const SENSITIVE_KEY_PATTERN = /api[-_]?key|token|secret|pass|password|authorization|cookie/i

export const okResult = <T>(summary: string, data?: T): { ok: true; summary: string; data?: T } => ({
  ok: true,
  summary,
  ...(data === undefined ? {} : { data })
})

export const sanitizeForAgent = (value: unknown): unknown => {
  const text = JSON.stringify(value, (key, item) => {
    if (SENSITIVE_KEY_PATTERN.test(key) && typeof item === 'string') {
      return item ? '[redacted]' : item
    }
    return item
  })
  return text === undefined ? undefined : JSON.parse(text)
}

export const pickPath = (value: any, keyPath = '') => {
  if (!keyPath) return value
  return keyPath.split('.').reduce((current, key) => current?.[key], value)
}

export const resolveInsideRoot = (root: string, input?: string, defaultExt?: string) => {
  const raw = (input || '').trim()
  const candidate = path.resolve(path.isAbsolute(raw) ? raw : path.join(root, raw))
  const resolved = defaultExt && path.extname(candidate) === '' ? `${candidate}${defaultExt}` : candidate
  if (resolved !== root && !isPathInside(resolved, root)) {
    throw new Error('Path is outside the allowed root directory')
  }
  return resolved
}

export const navigateApp = async (route: string) => {
  const nextRoute = route.startsWith('/') ? route : `/${route}`
  const allowed = ['/', '/settings', '/settings/', '/knowledge', '/paintings', '/notes', '/agents']
  if (!allowed.some((prefix) => nextRoute === prefix || nextRoute.startsWith(`${prefix}/`))) {
    throw new Error(`Navigation route is not allowed: ${nextRoute}`)
  }

  const win = windowService.getMainWindow()
  if (!win || win.isDestroyed()) throw new Error('Main window is not available')

  await win.webContents.executeJavaScript(`window.navigate(${JSON.stringify(nextRoute)})`)
  if (isMac) windowService.showMainWindow()
}

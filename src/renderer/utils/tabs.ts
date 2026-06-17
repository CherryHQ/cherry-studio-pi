export const TAB_INSTANCE_PARAM = 'tab'

export const parseTabUrl = (path: string) => {
  try {
    return new URL(path || '/', 'app://perry')
  } catch {
    return new URL('/', 'app://perry')
  }
}

export const getTabBaseIdFromPath = (path: string): string => {
  const { pathname } = parseTabUrl(path)
  if (pathname === '/') return 'home'
  const segments = pathname.split('/')

  if (segments[1] === 'apps' && segments[2]) {
    return `apps:${segments[2]}`
  }

  return segments[1] || 'home'
}

export const getTabBaseId = (tabId: string) => tabId.split('#')[0]

export const getTabInstanceId = (tabId: string) => {
  const [, instanceId] = tabId.split('#')
  return instanceId
}

export const getTabIdFromPath = (path: string): string => {
  const url = parseTabUrl(path)
  const baseTabId = getTabBaseIdFromPath(path)
  const instanceId = url.searchParams.get(TAB_INSTANCE_PARAM)

  return instanceId ? `${baseTabId}#${instanceId}` : baseTabId
}

export const createTaskTabPath = (path: string) => {
  const url = parseTabUrl(path)
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  url.searchParams.set(TAB_INSTANCE_PARAM, id)

  return `${url.pathname}${url.search}${url.hash}`
}

export const withTabInstance = (path: string, instanceId?: string) => {
  if (!instanceId) {
    return path
  }

  const url = parseTabUrl(path)
  url.searchParams.set(TAB_INSTANCE_PARAM, instanceId)

  return `${url.pathname}${url.search}${url.hash}`
}

export const canCloseVisibleTab = (visibleTabCount: number) => visibleTabCount > 1

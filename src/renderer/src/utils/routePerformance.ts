import { loggerService } from '@logger'

const logger = loggerService.withContext('RoutePerformance')

type RouteSwitchMark = {
  path: string
  source: string
  startedAt: number
}

const MARK_KEY = '__perryRouteSwitchMark'

const getMarkStore = () => globalThis as typeof globalThis & { [MARK_KEY]?: RouteSwitchMark }

export const markRouteSwitchStart = (source: string, path: string) => {
  if (!globalThis.performance) return

  getMarkStore()[MARK_KEY] = {
    path,
    source,
    startedAt: performance.now()
  }
}

export const markRouteSwitchPainted = (route: string, path: string) => {
  if (!globalThis.performance) return

  const store = getMarkStore()
  const mark = store[MARK_KEY]
  if (!mark) return

  const duration = performance.now() - mark.startedAt
  logger.debug(`route switch painted: ${mark.source} -> ${route}`, {
    duration: Math.round(duration),
    fromPath: mark.path,
    toPath: path
  })

  delete store[MARK_KEY]
}

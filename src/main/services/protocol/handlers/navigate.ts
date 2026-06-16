import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import { isAllowedInAppRoute, normalizeInAppRoute } from '@main/services/navigation/AppRouteNormalizer'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'

const logger = loggerService.withContext('ProtocolService:navigate')

const MAX_NAVIGATE_RETRY_ATTEMPTS = 30

function scheduleNavigateRetry(url: URL, retryAttempt: number) {
  const retryTimer = setTimeout(() => handleNavigateProtocolUrl(url, retryAttempt), 1000)
  retryTimer.unref?.()
}

/**
 * Handle cherrystudio://navigate/<path> deep links.
 *
 * Examples:
 *   cherrystudio://navigate/settings/provider
 *   cherrystudio://navigate/agents
 *   cherrystudio://navigate/knowledge
 */
export function handleNavigateProtocolUrl(url: URL, retryAttempt = 0) {
  const targetPath = url.pathname || '/'
  const fullPath = normalizeInAppRoute(`${targetPath}${url.search || ''}`)

  if (!isAllowedInAppRoute(fullPath)) {
    logger.warn(`Blocked navigation to disallowed route: ${fullPath}`)
    return
  }

  logger.debug('handleNavigateProtocolUrl', { path: fullPath })

  if (fullPath.startsWith('/settings/')) {
    application.get('SettingsWindowService').open(normalizeSettingsPath(fullPath))
    return
  }

  const navigateMainWindow = async () => {
    const mainWindow = application.get('WindowManager').getWindowsByType(WindowType.Main)[0]

    if (!mainWindow) {
      if (retryAttempt >= MAX_NAVIGATE_RETRY_ATTEMPTS) {
        logger.warn('Main window not available, dropping navigation URL after retry limit', { path: fullPath })
        return
      }

      logger.warn('Main window not available, retrying in 1s', { retryAttempt: retryAttempt + 1 })
      scheduleNavigateRetry(url, retryAttempt + 1)
      return
    }

    try {
      const hasNavigate = await mainWindow.webContents.executeJavaScript(`typeof window.navigate === 'function'`)

      if (!hasNavigate) {
        if (retryAttempt >= MAX_NAVIGATE_RETRY_ATTEMPTS) {
          logger.warn('window.navigate not available, dropping navigation URL after retry limit', { path: fullPath })
          return
        }

        logger.warn('window.navigate not available yet, retrying in 1s', { retryAttempt: retryAttempt + 1 })
        scheduleNavigateRetry(url, retryAttempt + 1)
        return
      }

      await mainWindow.webContents.executeJavaScript(`window.navigate({ to: ${JSON.stringify(fullPath)} })`)
      // Always raise Main: Win/Linux used to rely on MainWindowService's
      // `second-instance` listener for this, but that listener now skips
      // protocol URLs to avoid stealing focus from Settings/OAuth flows.
      application.get('MainWindowService').showMainWindow()
    } catch (error) {
      logger.error('Failed to navigate:', error as Error)
    }
  }

  void navigateMainWindow()
}

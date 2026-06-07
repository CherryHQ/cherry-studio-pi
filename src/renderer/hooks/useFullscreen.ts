import { loggerService } from '@logger'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useFullscreen')

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    let cancelled = false

    void window.api.windowManager
      .isFullScreen()
      .then((value) => {
        if (!cancelled) setIsFullscreen(value)
      })
      .catch((error) => {
        logger.warn('Failed to read fullscreen state', error as Error)
      })

    const unsubscribe = window.api.windowManager.onFullscreenChange(setIsFullscreen)

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return isFullscreen
}

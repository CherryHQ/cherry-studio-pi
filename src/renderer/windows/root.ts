import { loggerService } from '@logger'
import { createRoot, type Root } from 'react-dom/client'

const logger = loggerService.withContext('RendererWindowRoot')

export function createRendererRoot(windowName: string, rootId = 'root'): Root {
  let element = document.getElementById(rootId)
  if (!element) {
    logger.error(`Missing #${rootId} mount node for ${windowName}; creating a fallback root`)
    element = document.createElement('div')
    element.id = rootId
    const fallbackParent = document.body ?? document.documentElement
    fallbackParent.appendChild(element)
  }

  return createRoot(element)
}

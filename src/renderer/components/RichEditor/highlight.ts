import { loggerService } from '@logger'

import { MARKDOWN_SOURCE_LINE_ATTR } from './constants'

const logger = loggerService.withContext('RichEditor')

type Cleanup = () => void

let activeHighlightCleanup: Cleanup | null = null

/**
 * Find element by line number with fallback strategies:
 * 1. Exact line + content match
 * 2. Exact line match
 * 3. Closest line <= target
 */
export function findElementByLine(
  editorDom: HTMLElement,
  lineNumber: number,
  lineContent?: string
): HTMLElement | null {
  const allElements = Array.from(editorDom.querySelectorAll<HTMLElement>(`[${MARKDOWN_SOURCE_LINE_ATTR}]`))
  if (allElements.length === 0) {
    logger.warn('No elements with data-source-line attribute found')
    return null
  }
  const exactMatches = editorDom.querySelectorAll<HTMLElement>(`[${MARKDOWN_SOURCE_LINE_ATTR}="${lineNumber}"]`)

  if (exactMatches.length > 1 && lineContent) {
    for (const match of Array.from(exactMatches)) {
      if (match.textContent?.includes(lineContent)) {
        return match
      }
    }
  }

  if (exactMatches.length > 0) {
    return exactMatches[0]
  }

  let closestElement: HTMLElement | null = null
  let closestLine = 0

  for (const el of allElements) {
    const sourceLine = parseInt(el.getAttribute(MARKDOWN_SOURCE_LINE_ATTR) || '0', 10)
    if (sourceLine <= lineNumber && sourceLine > closestLine) {
      closestLine = sourceLine
      closestElement = el
    }
  }

  return closestElement
}

export function clearRichEditorHighlight(): void {
  activeHighlightCleanup?.()
  activeHighlightCleanup = null
}

/**
 * Create fixed-position highlight overlay at element location
 * with boundary detection to prevent overflow and toolbar overlap.
 */
export function createHighlightOverlay(element: HTMLElement, container: HTMLElement): Cleanup {
  let overlay: HTMLElement | null = null
  let cleanup: Cleanup = () => {}

  try {
    clearRichEditorHighlight()

    const editorWrapper = container.closest('.rich-editor-wrapper')
    const rect = element.getBoundingClientRect()
    overlay = document.createElement('div')
    overlay.className = 'highlight-overlay animation-locate-highlight'
    overlay.style.position = 'fixed'
    overlay.style.left = `${rect.left}px`
    overlay.style.top = `${rect.top}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
    overlay.style.pointerEvents = 'none'
    overlay.style.zIndex = '9999'
    overlay.style.borderRadius = '4px'

    document.body.appendChild(overlay)

    const updatePosition = () => {
      if (!overlay) return

      const newRect = element.getBoundingClientRect()
      const newContainerRect = container.getBoundingClientRect()

      overlay.style.left = `${newRect.left}px`
      overlay.style.top = `${newRect.top}px`
      overlay.style.width = `${newRect.width}px`
      overlay.style.height = `${newRect.height}px`

      const currentToolbar = editorWrapper?.querySelector('[class*="ToolbarWrapper"]')
      const currentToolbarRect = currentToolbar?.getBoundingClientRect()
      const currentToolbarBottom = currentToolbarRect ? currentToolbarRect.bottom : newContainerRect.top

      const overlayTop = newRect.top
      const overlayBottom = newRect.bottom
      const visibleTop = currentToolbarBottom
      const visibleBottom = newContainerRect.bottom

      if (overlayTop < visibleTop || overlayBottom > visibleBottom) {
        overlay.style.opacity = '0'
        overlay.style.visibility = 'hidden'
      } else {
        overlay.style.opacity = '1'
        overlay.style.visibility = 'visible'
      }
    }

    const handleAnimationEnd = () => cleanup()

    cleanup = () => {
      if (!overlay) return

      const currentOverlay = overlay
      overlay = null
      container.removeEventListener('scroll', updatePosition)
      currentOverlay.removeEventListener('animationend', handleAnimationEnd)
      currentOverlay.remove()

      if (activeHighlightCleanup === cleanup) {
        activeHighlightCleanup = null
      }
    }

    container.addEventListener('scroll', updatePosition)
    overlay.addEventListener('animationend', handleAnimationEnd)
    activeHighlightCleanup = cleanup

    return cleanup
  } catch (error) {
    logger.error('Failed to create highlight overlay:', error as Error)
    return cleanup
  }
}

/**
 * Scroll to element and show highlight after scroll completes.
 */
export function scrollAndHighlight(element: HTMLElement, container: HTMLElement): Cleanup {
  let disposed = false
  let overlayCleanup: Cleanup | null = null
  const timers = new Set<number>()
  const frames = new Set<number>()

  const scheduleTimeout = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      if (!disposed) {
        callback()
      }
    }, delay)
    timers.add(timer)
    return timer
  }

  const clearScheduledTimeout = (timer: number | null) => {
    if (!timer) return
    window.clearTimeout(timer)
    timers.delete(timer)
  }

  const scheduleFrame = (callback: () => void) => {
    const frame = window.requestAnimationFrame(() => {
      frames.delete(frame)
      if (!disposed) {
        callback()
      }
    })
    frames.add(frame)
    return frame
  }

  const showHighlight = () => {
    if (disposed) return
    overlayCleanup = createHighlightOverlay(element, container)
  }

  let scrollTimeout: number | null = null
  const handleScroll = () => {
    clearScheduledTimeout(scrollTimeout)
    scrollTimeout = scheduleTimeout(() => {
      scrollTimeout = null
      container.removeEventListener('scroll', handleScroll)
      scheduleFrame(showHighlight)
    }, 150)
  }

  element.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
  container.addEventListener('scroll', handleScroll)

  scheduleTimeout(() => {
    const initialScrollTop = container.scrollTop
    scheduleTimeout(() => {
      if (Math.abs(container.scrollTop - initialScrollTop) < 1) {
        container.removeEventListener('scroll', handleScroll)
        clearScheduledTimeout(scrollTimeout)
        scrollTimeout = null
        scheduleFrame(showHighlight)
      }
    }, 200)
  }, 50)

  return () => {
    if (disposed) return

    disposed = true
    container.removeEventListener('scroll', handleScroll)
    for (const timer of timers) {
      window.clearTimeout(timer)
    }
    timers.clear()
    for (const frame of frames) {
      window.cancelAnimationFrame(frame)
    }
    frames.clear()
    overlayCleanup?.()
    overlayCleanup = null
  }
}

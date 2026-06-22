export const RESOURCE_SELECTOR_FORCE_CLOSE_EVENT = 'cherry:resource-selector:force-close'

export type ResourceSelectorForceCloseEvent = CustomEvent<{
  sourceId?: string
}>

export function getResourceSelectorForceCloseSource(event: Event): string | undefined {
  if (!('detail' in event)) return undefined
  const detail = (event as ResourceSelectorForceCloseEvent).detail
  return typeof detail?.sourceId === 'string' ? detail.sourceId : undefined
}

export function requestCloseResourceSelectors(sourceId?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(createResourceSelectorForceCloseEvent(sourceId))
}

function createResourceSelectorForceCloseEvent(sourceId?: string): ResourceSelectorForceCloseEvent {
  const detail = { sourceId }
  const eventConstructor = typeof window !== 'undefined' ? window.CustomEvent : globalThis.CustomEvent

  if (typeof eventConstructor === 'function') {
    return new eventConstructor(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, { detail })
  }

  const event = new Event(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT) as ResourceSelectorForceCloseEvent
  Object.defineProperty(event, 'detail', {
    configurable: true,
    value: detail
  })
  return event
}

export function getModalSurfaceElements(): Element[] {
  if (typeof document === 'undefined') return []
  return Array.from(
    document.querySelectorAll(
      [
        '[data-slot="dialog-content"]',
        '[data-slot="page-side-panel"]',
        '[role="dialog"]',
        '[aria-modal="true"]',
        '.ant-modal',
        '.ant-drawer-content-wrapper',
        '.ant-drawer-content'
      ].join(', ')
    )
  )
}

function isHiddenModalSurface(element: Element) {
  if (!(element instanceof HTMLElement)) return false
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true
  if (element.getAttribute('data-state') === 'closed') return true

  const style = typeof window !== 'undefined' ? window.getComputedStyle(element) : undefined
  return style?.display === 'none' || style?.visibility === 'hidden'
}

export function getActiveModalSurfaceElements(): Element[] {
  return getModalSurfaceElements().filter((element) => !isHiddenModalSurface(element))
}

export function closeTransientResourceSelectors() {
  requestCloseResourceSelectors()
}

function scheduleMicrotask(callback: () => void) {
  if (typeof window.queueMicrotask === 'function') {
    window.queueMicrotask(callback)
    return
  }

  void Promise.resolve().then(callback)
}

function scheduleFrame(callback: FrameRequestCallback) {
  if (typeof window.requestAnimationFrame === 'function' && typeof window.cancelAnimationFrame === 'function') {
    const frame = window.requestAnimationFrame(callback)
    return () => window.cancelAnimationFrame(frame)
  }

  const timer = window.setTimeout(() => callback(Date.now()), 16)
  return () => window.clearTimeout(timer)
}

export function scheduleCloseTransientResourceSelectors() {
  closeTransientResourceSelectors()

  if (typeof window === 'undefined') return undefined

  scheduleMicrotask(closeTransientResourceSelectors)
  let cancelNestedFrame: (() => void) | undefined
  const cancelFrames = [
    scheduleFrame(closeTransientResourceSelectors),
    scheduleFrame(() => {
      cancelNestedFrame = scheduleFrame(closeTransientResourceSelectors)
    })
  ]
  const timers = [
    window.setTimeout(closeTransientResourceSelectors, 50),
    window.setTimeout(closeTransientResourceSelectors, 150),
    window.setTimeout(closeTransientResourceSelectors, 300)
  ]

  return () => {
    cancelFrames.forEach((cancelFrame) => cancelFrame())
    cancelNestedFrame?.()
    timers.forEach((timer) => window.clearTimeout(timer))
  }
}

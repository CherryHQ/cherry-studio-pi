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
  window.dispatchEvent(new CustomEvent(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, { detail: { sourceId } }))
}

export function getModalSurfaceElements(): Element[] {
  if (typeof document === 'undefined') return []
  return Array.from(document.querySelectorAll('[data-slot="dialog-content"], [role="dialog"], [aria-modal="true"]'))
}

export function closeTransientResourceSelectors() {
  requestCloseResourceSelectors()
  if (typeof document === 'undefined') return

  const escapeEventInit: KeyboardEventInit = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }
  document.dispatchEvent(new KeyboardEvent('keydown', escapeEventInit))
  window.dispatchEvent(new KeyboardEvent('keydown', escapeEventInit))
}

export function scheduleCloseTransientResourceSelectors() {
  closeTransientResourceSelectors()

  if (typeof window === 'undefined') return undefined

  window.queueMicrotask(closeTransientResourceSelectors)
  const frames: number[] = []
  frames.push(window.requestAnimationFrame(closeTransientResourceSelectors))
  frames.push(
    window.requestAnimationFrame(() => {
      frames.push(window.requestAnimationFrame(closeTransientResourceSelectors))
    })
  )
  const timers = [
    window.setTimeout(closeTransientResourceSelectors, 50),
    window.setTimeout(closeTransientResourceSelectors, 150),
    window.setTimeout(closeTransientResourceSelectors, 300)
  ]

  return () => {
    frames.forEach((frame) => window.cancelAnimationFrame(frame))
    timers.forEach((timer) => window.clearTimeout(timer))
  }
}

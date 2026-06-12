export const RESOURCE_SELECTOR_FORCE_CLOSE_EVENT = 'cherry:resource-selector:force-close'

export function requestCloseResourceSelectors() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT))
}

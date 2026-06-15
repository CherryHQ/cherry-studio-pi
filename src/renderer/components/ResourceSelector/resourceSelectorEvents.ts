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

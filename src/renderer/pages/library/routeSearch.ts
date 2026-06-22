import type { ResourceType } from './types'

export type LibraryRouteAction = 'create' | 'edit'

export type LibraryRouteSearch = {
  resourceType?: ResourceType
  action?: LibraryRouteAction
  id?: string
}

export function buildLibraryCreateSearch(resourceType: ResourceType): LibraryRouteSearch {
  return {
    resourceType,
    action: 'create'
  }
}

export function buildLibraryEditSearch(resourceType: ResourceType, id: string): LibraryRouteSearch {
  return {
    resourceType,
    action: 'edit',
    id
  }
}

export function buildLibraryRouteUrl(search: LibraryRouteSearch): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `/app/library?${query}` : '/app/library'
}

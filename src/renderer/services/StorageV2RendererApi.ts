export function getRendererStorageV2Api() {
  if (typeof window === 'undefined') {
    return { hasWindow: false, api: null }
  }

  return { hasWindow: true, api: window.api?.storageV2 ?? null }
}

export type RendererStorageV2Api = NonNullable<ReturnType<typeof getRendererStorageV2Api>['api']>

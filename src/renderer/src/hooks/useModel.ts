import { useMemo } from 'react'

import { useProviders } from './useProvider'
import { getStoreProviders } from './useStore'

export function useModel(id?: string, providerId?: string) {
  const { providers } = useProviders()
  const allModels = useMemo(() => providers.flatMap((p) => p.models), [providers])
  return allModels.find((m) => {
    if (providerId) {
      return m.id === id && m.provider === providerId
    } else {
      return m.id === id
    }
  })
}

export function getModel(id?: string, providerId?: string) {
  const providers = getStoreProviders()
  const allModels = providers.flatMap((p) => p.models)
  return allModels.find((m) => {
    if (providerId) {
      return m.id === id && m.provider === providerId
    } else {
      return m.id === id
    }
  })
}

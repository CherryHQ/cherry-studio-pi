import { loggerService } from '@logger'
import { useProvider, useProviderApiKeys, useProviderMutations } from '@renderer/hooks/useProvider'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import type { ApiKeysData } from './types'

const logger = loggerService.withContext('useProviderApiKey')

export interface ApiKeyValue {
  serverApiKey: string
  inputApiKey: string
  hasPendingSync: boolean
}

export interface ApiKeyState extends ApiKeyValue {
  setInputApiKey: (value: string) => void
  commitInputApiKeyNow: () => Promise<void>
}

function getEnabledApiKeyString(apiKeysData: ApiKeysData | undefined) {
  return (
    apiKeysData?.keys
      ?.filter((item) => item.isEnabled)
      .map((item) => item.key)
      .join(',') ?? ''
  )
}

function parseApiKeys(value: string) {
  const seenKeys = new Set<string>()

  return splitApiKeyString(formatApiKeys(value)).filter((key) => {
    if (seenKeys.has(key)) {
      return false
    }

    seenKeys.add(key)
    return true
  })
}

function toEnabledApiKeyString(value: string) {
  return parseApiKeys(value).join(',')
}

function toApiKeyEntries(value: string, apiKeysData: ApiKeysData | undefined): ApiKeyEntry[] {
  const nextEnabledKeys = parseApiKeys(value)
  const existingKeys = apiKeysData?.keys ?? []
  const existingEnabledKeys = existingKeys.filter((item) => item.isEnabled)
  const usedEntryIds = new Set<string>()
  const nextEntries: ApiKeyEntry[] = []
  let enabledCursor = 0

  for (const key of nextEnabledKeys) {
    const matchedEntry = existingKeys.find((item) => !usedEntryIds.has(item.id) && item.key.trim() === key)

    if (matchedEntry) {
      usedEntryIds.add(matchedEntry.id)
      nextEntries.push({ ...matchedEntry, key, isEnabled: true })
      continue
    }

    while (enabledCursor < existingEnabledKeys.length && usedEntryIds.has(existingEnabledKeys[enabledCursor].id)) {
      enabledCursor += 1
    }

    const reusableEnabledEntry = existingEnabledKeys[enabledCursor]
    if (reusableEnabledEntry) {
      usedEntryIds.add(reusableEnabledEntry.id)
      nextEntries.push({ ...reusableEnabledEntry, key, isEnabled: true })
      enabledCursor += 1
      continue
    }

    nextEntries.push({ id: uuidv4(), key, isEnabled: true })
  }

  const untouchedDisabledEntries = existingKeys.filter((item) => !item.isEnabled && !usedEntryIds.has(item.id))
  return [...nextEntries, ...untouchedDisabledEntries]
}

function createApiKeyValue(serverApiKey: string): ApiKeyValue {
  return {
    serverApiKey,
    inputApiKey: serverApiKey,
    hasPendingSync: false
  }
}

function isSameApiKeyValue(left: ApiKeyValue, right: ApiKeyValue) {
  return (
    left.serverApiKey === right.serverApiKey &&
    left.inputApiKey === right.inputApiKey &&
    left.hasPendingSync === right.hasPendingSync
  )
}

function syncApiKeyValueFromServer(value: ApiKeyValue, serverApiKey: string): ApiKeyValue {
  if (!value.hasPendingSync) {
    return createApiKeyValue(serverApiKey)
  }

  const normalizedInputApiKey = toEnabledApiKeyString(value.inputApiKey)
  if (normalizedInputApiKey === serverApiKey) {
    return createApiKeyValue(serverApiKey)
  }

  return {
    ...value,
    serverApiKey,
    hasPendingSync: true
  }
}

/** Owns API key input state for one authentication section and syncs it to provider settings. */
export function useProviderApiKey(providerId: string) {
  const { provider } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { updateApiKeys } = useProviderMutations(providerId)

  const serverApiKey = useMemo(() => getEnabledApiKeyString(apiKeysData), [apiKeysData])
  const [value, setValue] = useState<ApiKeyValue>(() => createApiKeyValue(serverApiKey))
  const previousProviderIdRef = useRef(providerId)
  const valueRef = useRef(value)
  const saveApiKeyRef = useRef<(value: string) => Promise<void>>(async () => undefined)

  const saveApiKey = useCallback(
    async (value: string) => {
      if (!provider) {
        return
      }

      const normalizedValue = toEnabledApiKeyString(value)
      const existingKeys = apiKeysData?.keys ?? []
      const hasPersistedKey = existingKeys.some((item) => item.key.trim())

      if (!normalizedValue && hasPersistedKey) {
        logger.warn('Skipped empty inline API key save to avoid clearing provider credentials', { providerId })
        throw new Error('Refusing to clear provider API keys from inline autosave')
      }

      await updateApiKeys(toApiKeyEntries(normalizedValue, apiKeysData))
    },
    [apiKeysData, provider, providerId, updateApiKeys]
  )

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    saveApiKeyRef.current = saveApiKey
  }, [saveApiKey])

  useEffect(() => {
    const providerChanged = previousProviderIdRef.current !== providerId
    previousProviderIdRef.current = providerId

    const nextValue = providerChanged
      ? createApiKeyValue(serverApiKey)
      : syncApiKeyValueFromServer(valueRef.current, serverApiKey)

    setValue((previousValue) => (isSameApiKeyValue(previousValue, nextValue) ? previousValue : nextValue))
  }, [providerId, serverApiKey])

  const setInputApiKey = useCallback((nextInputApiKey: string) => {
    const normalizedInputApiKey = toEnabledApiKeyString(nextInputApiKey)
    const hasPendingSync = normalizedInputApiKey !== valueRef.current.serverApiKey

    setValue((previousValue) => {
      const nextValue = {
        ...previousValue,
        inputApiKey: nextInputApiKey,
        hasPendingSync
      }

      return isSameApiKeyValue(previousValue, nextValue) ? previousValue : nextValue
    })
  }, [])

  const commitInputApiKeyNow = useCallback(async () => {
    const currentValue = valueRef.current
    const normalizedInputApiKey = toEnabledApiKeyString(currentValue.inputApiKey)
    if (normalizedInputApiKey === currentValue.serverApiKey) {
      return
    }

    await saveApiKeyRef.current(normalizedInputApiKey)
  }, [])

  return useMemo(
    () => ({
      ...value,
      setInputApiKey,
      commitInputApiKeyNow
    }),
    [commitInputApiKeyNow, setInputApiKey, value]
  )
}

export function encodeStorageV2CompositeEntityId(idValues: readonly string[]) {
  return JSON.stringify(idValues)
}

export function decodeStorageV2CompositeEntityId(entityId: string, expectedParts: number): string[] | null {
  try {
    const parsed = JSON.parse(entityId)
    if (
      Array.isArray(parsed) &&
      parsed.length === expectedParts &&
      parsed.every((value): value is string => typeof value === 'string' && value.length > 0)
    ) {
      return parsed
    }
  } catch {
    // Legacy tombstones used colon-joined composite ids.
  }

  const legacyParts = entityId.split(':')
  if (legacyParts.length === expectedParts && legacyParts.every(Boolean)) {
    return legacyParts
  }

  return null
}

export function listStorageV2CompositeEntityIdCandidates(idValues: readonly string[]) {
  const encoded = encodeStorageV2CompositeEntityId(idValues)
  const legacy = idValues.join(':')
  return encoded === legacy ? [encoded] : [encoded, legacy]
}

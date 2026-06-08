type StorageV2PartialReduxSnapshotOptions = {
  pruneMissing?: boolean
}

export async function persistStorageV2PartialReduxSnapshot(
  snapshot: Record<string, unknown>,
  options: StorageV2PartialReduxSnapshotOptions = {}
) {
  const importLegacyReduxSnapshot = window.api?.storageV2?.importLegacyReduxSnapshot

  if (typeof importLegacyReduxSnapshot !== 'function') {
    throw new Error('Storage v2 Redux slice import API unavailable')
  }

  await importLegacyReduxSnapshot(snapshot, { dryRun: false, pruneMissing: options.pruneMissing === true })
}

export async function persistStorageV2ReduxSlice(
  sliceName: string,
  value: unknown,
  options?: StorageV2PartialReduxSnapshotOptions
) {
  await persistStorageV2PartialReduxSnapshot(
    {
      redux: {
        [sliceName]: value
      }
    },
    options
  )
}

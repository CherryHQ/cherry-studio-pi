export async function persistStorageV2PartialReduxSnapshot(snapshot: Record<string, unknown>) {
  const importLegacyReduxSnapshot = window.api?.storageV2?.importLegacyReduxSnapshot

  if (typeof importLegacyReduxSnapshot !== 'function') {
    throw new Error('Storage v2 Redux slice import API unavailable')
  }

  await importLegacyReduxSnapshot(snapshot, { dryRun: false, pruneMissing: true })
}

export async function persistStorageV2ReduxSlice(sliceName: string, value: unknown) {
  await persistStorageV2PartialReduxSnapshot({
    redux: {
      [sliceName]: value
    }
  })
}

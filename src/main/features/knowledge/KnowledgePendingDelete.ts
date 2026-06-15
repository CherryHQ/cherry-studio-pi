export function getRemainingPendingDeleteIds(pendingIds: readonly string[], deletedIds: readonly string[]): string[] {
  const deleted = new Set(deletedIds)
  return [...new Set(pendingIds)].filter((id) => !deleted.has(id))
}

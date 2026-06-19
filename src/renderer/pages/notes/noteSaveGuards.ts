export function hasNoteContentChanged(nextContent: string, currentContent: string): boolean {
  return nextContent !== currentContent
}

export function hasPendingNoteSave(nextContent: string, filePath: string | undefined, currentContent: string): boolean {
  return Boolean(filePath) && hasNoteContentChanged(nextContent, currentContent)
}

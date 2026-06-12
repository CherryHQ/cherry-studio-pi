export function restoreTextareaCursor(textarea: HTMLTextAreaElement, cursorPosition: number): boolean {
  if (!document.contains(textarea)) {
    return false
  }

  textarea.focus()
  textarea.setSelectionRange(cursorPosition, cursorPosition)
  return true
}

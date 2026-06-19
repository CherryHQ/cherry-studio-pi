export type TaskTextFieldBlurResolution =
  | { action: 'noop' }
  | { action: 'reset'; value: string }
  | { action: 'save'; value: string }

export function resolveTaskTextFieldBlur(draftValue: string, currentValue: string): TaskTextFieldBlurResolution {
  if (draftValue === currentValue) {
    return { action: 'noop' }
  }

  const normalizedValue = draftValue.trim()
  if (!normalizedValue || normalizedValue === currentValue) {
    return { action: 'reset', value: currentValue }
  }

  return { action: 'save', value: normalizedValue }
}

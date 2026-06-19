export function parseTaskTimeoutMinutes(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) return null

  const minutes = Number(trimmed)
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return null

  return minutes
}

export function resolveTaskTimeoutBlur(
  draftValue: string,
  currentValue: number | null | undefined
): { action: 'noop' } | { action: 'reset'; value: string } | { action: 'save'; value: number } {
  const current = currentValue ?? null
  const parsed = parseTaskTimeoutMinutes(draftValue)

  if (!draftValue.trim()) {
    if (current === null) return { action: 'noop' }
    return { action: 'reset', value: String(current) }
  }

  if (parsed === null) {
    return { action: 'reset', value: current === null ? '' : String(current) }
  }

  if (parsed === current) {
    if (draftValue.trim() === String(current)) return { action: 'noop' }
    return { action: 'reset', value: String(current) }
  }

  return { action: 'save', value: parsed }
}

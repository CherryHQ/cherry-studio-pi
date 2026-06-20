export interface NormalizeBoundedIntegerInputOptions {
  label: string
  defaultValue: number
  min?: number
  max?: number
  emptyStringValue?: number
  invalidNumberValue?: number
  invalidTypeMessage?: string
}

export function normalizeBoundedIntegerInput(value: unknown, options: NormalizeBoundedIntegerInputOptions) {
  const {
    label,
    defaultValue,
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
    emptyStringValue = defaultValue,
    invalidNumberValue = defaultValue,
    invalidTypeMessage
  } = options

  if (value !== null && typeof value !== 'undefined' && typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(invalidTypeMessage ?? `${label} must be a number`)
  }

  const parsed = typeof value === 'string' && !value.trim() ? emptyStringValue : Number(value ?? defaultValue)
  const safeValue = Number.isFinite(parsed) ? Math.trunc(parsed) : invalidNumberValue
  return Math.max(min, Math.min(safeValue, max))
}

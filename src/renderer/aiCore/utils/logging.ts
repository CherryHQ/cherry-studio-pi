function summarizeObjectShape(input: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (input == null) return input
  if (Array.isArray(input)) return { type: 'array', length: input.length }
  if (typeof input !== 'object') return { type: typeof input }
  if (seen.has(input)) return { type: 'object', circular: true }

  seen.add(input)
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (depth <= 0) return { type: 'object', keys }

  return {
    type: 'object',
    keys,
    fields: Object.fromEntries(keys.map((key) => [key, summarizeObjectShape(record[key], depth - 1, seen)]))
  }
}

export function summarizeObjectShapeForLog(input: unknown, depth = 2): unknown {
  return summarizeObjectShape(input, depth, new WeakSet<object>())
}

export function summarizeTextForLog(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string') {
    return { value: summarizeObjectShapeForLog(input) }
  }

  return {
    type: 'string',
    length: input.length,
    trimmedLength: input.trim().length,
    isEmpty: input.trim().length === 0
  }
}

export function summarizeTextListForLog(values: unknown[]): Record<string, unknown> {
  const sampleLimit = 50
  const sampledValues = values.slice(0, sampleLimit)

  return {
    type: 'array',
    length: values.length,
    items: sampledValues.map((value) => summarizeTextForLog(value)),
    truncated: values.length > sampleLimit,
    truncatedCount: Math.max(0, values.length - sampleLimit)
  }
}

export function summarizeUrlForLog(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string') {
    return { value: summarizeObjectShapeForLog(input) }
  }

  try {
    const url = new URL(input)
    return {
      type: 'url',
      protocol: url.protocol,
      host: url.host,
      pathnameLength: url.pathname.length,
      searchLength: url.search.length,
      hashLength: url.hash.length,
      hasSearch: url.search.length > 0,
      hasHash: url.hash.length > 0
    }
  } catch {
    return {
      type: 'url',
      valid: false,
      length: input.length,
      trimmedLength: input.trim().length
    }
  }
}

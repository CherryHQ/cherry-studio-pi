const CAMEL_CASE_KEY_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/g
const TOKEN_METRIC_NORMALIZED_KEY_PATTERN =
  /\b(?:token|tokens)\s+(?:count|counts|used|usage|total|prompt|completion|input|output|estimated|remaining|limit|limits)\b|^(?:total|prompt|completion|input|output|estimated|remaining|max)\s+tokens?\b/
const SENSITIVE_NORMALIZED_KEY_PATTERN =
  /\b(?:api keys?|private keys?|access keys?|tokens?|secrets?|passwords?|passwd|passphrases?|passcodes?|pass|authorizations?|credentials?|cookies?)\b/
const AGENT_TEXT_SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/((?:Authorization)\s*:\s*(?:Bearer|Basic)\s+)([^\s'",;]+)/gi, '$1[redacted]'],
  [/\b(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, '$1[redacted]@']
]
const QUOTED_KEY_VALUE_PATTERN = /(["'])([^"'\r\n]{1,120})\1(\s*:\s*)(["'])((?:\\.|(?!\4).){0,2048})\4/g
const UNQUOTED_KEY_VALUE_PATTERN = /(^|[^A-Za-z0-9_$])([A-Za-z0-9_.:-]{1,120})(\s*[=:]\s*)(["']?)([^'",;\s}\]]+)\4/g
const REDACTED_VALUE = '[redacted]'

export const isSensitiveAgentKey = (key: string): boolean => {
  const normalized = key
    .replace(CAMEL_CASE_KEY_BOUNDARY_PATTERN, '$1 $2')
    .replace(/[_./:\-\s]+/g, ' ')
    .trim()
    .toLowerCase()
  if (!normalized) return false
  if (TOKEN_METRIC_NORMALIZED_KEY_PATTERN.test(normalized)) return false
  return SENSITIVE_NORMALIZED_KEY_PATTERN.test(normalized)
}

export const redactAgentText = (text: string) => {
  const redactedKnownText = AGENT_TEXT_SECRET_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text
  )

  return redactedKnownText
    .replace(
      QUOTED_KEY_VALUE_PATTERN,
      (match, keyQuote: string, key: string, separator: string, valueQuote: string, value: string) => {
        if (!isSensitiveAgentKey(key) || value.length === 0 || value === REDACTED_VALUE) return match
        return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${REDACTED_VALUE}${valueQuote}`
      }
    )
    .replace(
      UNQUOTED_KEY_VALUE_PATTERN,
      (match, prefix: string, key: string, separator: string, valueQuote: string, value: string) => {
        if (
          !isSensitiveAgentKey(key) ||
          value.length === 0 ||
          value === REDACTED_VALUE.slice(0, -1) ||
          (key.toLowerCase() === 'authorization' && /^(?:Bearer|Basic)$/i.test(value))
        ) {
          return match
        }
        return `${prefix}${key}${separator}${valueQuote}${REDACTED_VALUE}${valueQuote}`
      }
    )
}

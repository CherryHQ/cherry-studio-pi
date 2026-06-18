const CAMEL_CASE_KEY_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/g
const TOKEN_METRIC_NORMALIZED_KEY_PATTERN =
  /\b(?:token|tokens)\s+(?:count|counts|used|usage|total|prompt|completion|input|output|estimated|remaining|limit|limits)\b|^(?:total|prompt|completion|input|output|estimated|remaining|max)\s+tokens?\b/
const MCP_SENSITIVE_NORMALIZED_KEY_PATTERN =
  /\b(?:api keys?|private keys?|access keys?|keys?|tokens?|secrets?|passwords?|passwd|passphrases?|passcodes?|pass|authorizations?|credentials?|cookies?)\b/

export function isSensitiveMcpDiagnosticKey(key: string): boolean {
  const normalized = key
    .replace(CAMEL_CASE_KEY_BOUNDARY_PATTERN, '$1 $2')
    .replace(/[_./:\-\s]+/g, ' ')
    .trim()
    .toLowerCase()
  if (!normalized) return false
  if (TOKEN_METRIC_NORMALIZED_KEY_PATTERN.test(normalized)) return false
  return MCP_SENSITIVE_NORMALIZED_KEY_PATTERN.test(normalized)
}

export function summarizeMCPFactoryEnvForLog(envs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(envs).map(([key, value]) => [key, isSensitiveMcpDiagnosticKey(key) ? '<redacted>' : value])
  )
}

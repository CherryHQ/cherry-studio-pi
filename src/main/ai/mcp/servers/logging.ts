const MCP_FACTORY_SENSITIVE_ENV_PATTERN =
  /api[-_]?key|private[-_]?key|(^|[-_])key$|token|secret|pass(word|phrase)?|passwd|authorization|cookie/i

export function summarizeMCPFactoryEnvForLog(envs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(envs).map(([key, value]) => [
      key,
      MCP_FACTORY_SENSITIVE_ENV_PATTERN.test(key) ? '<redacted>' : value
    ])
  )
}

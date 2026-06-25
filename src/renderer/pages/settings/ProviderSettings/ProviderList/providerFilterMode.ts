/**
 * Sidebar filter modes. The list is flat (no enabled/disabled split), so the
 * filter is also the only knob for hiding disabled providers.
 *
 * - `enabled`: only `isEnabled === true`
 * - `disabled`: only `isEnabled === false`
 * - `all` (default): every provider
 * - `claude-agent`: only providers that speak the Anthropic protocol required
 *   by the Claude Agent SDK. Pi agents are provider-agnostic and must not use
 *   this filter.
 */
export type ProviderFilterMode = 'enabled' | 'disabled' | 'all' | 'claude-agent'

export function normalizeProviderFilterMode(filter: string | undefined): ProviderFilterMode | undefined {
  if (filter === 'agent' || filter === 'claude-agent') {
    return 'claude-agent'
  }

  if (filter === 'enabled' || filter === 'disabled' || filter === 'all') {
    return filter
  }

  return undefined
}

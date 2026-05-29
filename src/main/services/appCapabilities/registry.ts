import type {
  AppCapabilityDefinition,
  AppCapabilityDescriptor,
  AppCapabilityListOptions,
  AppCapabilitySearchOptions
} from './types'

const normalize = (value: string) => value.toLowerCase().replace(/[_./:-]+/g, ' ')

const tokenize = (value: string) =>
  normalize(value)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

export class AppCapabilityRegistry {
  private readonly capabilities = new Map<string, AppCapabilityDefinition>()

  register(capability: AppCapabilityDefinition): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Duplicate app capability: ${capability.id}`)
    }
    this.capabilities.set(capability.id, capability)
  }

  registerMany(capabilities: AppCapabilityDefinition[]): void {
    for (const capability of capabilities) {
      this.register(capability)
    }
  }

  get(id: string): AppCapabilityDefinition | undefined {
    return this.capabilities.get(id)
  }

  list(options: AppCapabilityListOptions = {}): AppCapabilityDescriptor[] {
    return Array.from(this.capabilities.values())
      .filter((capability) => this.matchesListOptions(capability, options))
      .map((capability) => this.toDescriptor(capability, options.includeSchemas === true))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  search(options: AppCapabilitySearchOptions = {}): AppCapabilityDescriptor[] {
    const query = (options.query ?? '').trim()
    const limit = Math.max(1, Math.min(options.limit ?? 8, 50))
    if (!query) {
      return this.list(options).slice(0, limit)
    }

    const terms = tokenize(query)
    return Array.from(this.capabilities.values())
      .filter((capability) => this.matchesListOptions(capability, options))
      .map((capability) => ({
        capability,
        score: this.score(capability, terms)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id))
      .slice(0, limit)
      .map((item) => this.toDescriptor(item.capability, options.includeSchemas === true))
  }

  private matchesListOptions(capability: AppCapabilityDefinition, options: AppCapabilityListOptions): boolean {
    if (!options.includeHidden && capability.hidden) return false
    if (options.domain && capability.domain !== options.domain) return false
    if (options.risk && capability.risk !== options.risk) return false
    return true
  }

  private score(capability: AppCapabilityDefinition, terms: string[]): number {
    const fields = [
      [capability.id, 12],
      [capability.domain, 8],
      [capability.title, 7],
      [capability.description, 4],
      [(capability.tags ?? []).join(' '), 5],
      [(capability.aliases ?? []).join(' '), 6],
      [(capability.examples ?? []).join(' '), 3]
    ] as const

    let score = 0
    for (const term of terms) {
      for (const [field, weight] of fields) {
        const normalized = normalize(field)
        if (normalized === term) {
          score += weight * 2
        } else if (normalized.includes(term)) {
          score += weight
        }
      }
    }
    return score
  }

  private toDescriptor(capability: AppCapabilityDefinition, includeSchema: boolean): AppCapabilityDescriptor {
    const { execute: _execute, inputSchema, outputSchema, ...descriptor } = capability
    return {
      ...descriptor,
      ...(includeSchema ? { inputSchema, outputSchema } : {})
    }
  }
}

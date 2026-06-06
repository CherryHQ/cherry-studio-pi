import type {
  AppCapabilityDefinition,
  AppCapabilityDescriptor,
  AppCapabilityListOptions,
  AppCapabilitySearchOptions
} from './types'

const normalize = (value: string) => value.toLowerCase().replace(/[_./:-]+/g, ' ')
const DEFAULT_SEARCH_LIMIT = 8
const MAX_SEARCH_LIMIT = 50

const tokenize = (value: string) =>
  normalize(value)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

const QUERY_EXPANSIONS: Array<[RegExp, string[]]> = [
  [/备份|备份一下|保存数据/, ['backup', 'storage', 'create', 'data']],
  [/恢复|还原/, ['restore', 'backup', 'storage']],
  [/同步|云同步|多端|webdav/i, ['dataSync', 'sync', 'webdav']],
  [/目录|路径/, ['directory', 'path']],
  [/设置|配置|偏好/, ['settings', 'preferences', 'configuration']],
  [/语言/, ['language', 'settings']],
  [/主题|外观/, ['theme', 'display', 'settings']],
  [/知识库|知识|检索|搜索资料|rag/i, ['knowledge', 'rag', 'search']],
  [/笔记|文档|markdown/i, ['notes', 'markdown']],
  [/绘图|画图|生图|图片生成|图像生成/, ['paintings', 'image', 'generate', 'drawing']],
  [/智能体|agent/i, ['agents', 'agent']],
  [/mcp|工具|tool/i, ['mcp', 'tools']],
  [/任务|定时|计划/, ['tasks', 'schedule']],
  [/会话|对话/, ['sessions', 'conversations', 'chat']],
  [/模型|model/i, ['models', 'llm']],
  [/文件/, ['files', 'storage']],
  [/打开|跳转|进入/, ['open', 'navigate']],
  [/创建|新建/, ['create', 'new']],
  [/删除|移除/, ['delete', 'remove']],
  [/列表|列出|查看/, ['list', 'read']]
]

const expandQueryTerms = (query: string) => {
  const expanded = new Set(tokenize(query))
  for (const [pattern, additions] of QUERY_EXPANSIONS) {
    if (pattern.test(query)) {
      additions.forEach((term) => expanded.add(term))
    }
  }
  return Array.from(expanded)
}

const normalizeSearchLimit = (value: unknown) => {
  const parsed =
    typeof value === 'string' && !value.trim() ? DEFAULT_SEARCH_LIMIT : Number(value ?? DEFAULT_SEARCH_LIMIT)
  const safeLimit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_SEARCH_LIMIT
  return Math.max(1, Math.min(safeLimit, MAX_SEARCH_LIMIT))
}

type SearchIndexEntry = {
  capability: AppCapabilityDefinition
  fields: Array<readonly [normalized: string, weight: number]>
}

export class AppCapabilityRegistry {
  private readonly capabilities = new Map<string, AppCapabilityDefinition>()
  private readonly searchIndex = new Map<string, SearchIndexEntry>()

  register(capability: AppCapabilityDefinition): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Duplicate app capability: ${capability.id}`)
    }
    this.capabilities.set(capability.id, capability)
    this.searchIndex.set(capability.id, this.toSearchIndexEntry(capability))
  }

  registerMany(capabilities: AppCapabilityDefinition[]): void {
    for (const capability of capabilities) {
      this.register(capability)
    }
  }

  get(id: string): AppCapabilityDefinition | undefined {
    return this.capabilities.get(id)
  }

  getDescriptor(id: string, options: Pick<AppCapabilityListOptions, 'includeHidden' | 'includeSchemas'> = {}) {
    const capability = this.capabilities.get(id)
    if (!capability) return undefined
    if (!options.includeHidden && capability.hidden) return undefined
    return this.toDescriptor(capability, options.includeSchemas === true)
  }

  list(options: AppCapabilityListOptions = {}): AppCapabilityDescriptor[] {
    return this.sortedCapabilities(options).map((capability) =>
      this.toDescriptor(capability, options.includeSchemas === true)
    )
  }

  search(options: AppCapabilitySearchOptions = {}): AppCapabilityDescriptor[] {
    const query = String(options.query ?? '').trim()
    const limit = normalizeSearchLimit(options.limit)
    if (!query) {
      return this.sortedCapabilities(options)
        .slice(0, limit)
        .map((capability) => this.toDescriptor(capability, options.includeSchemas === true))
    }

    const terms = expandQueryTerms(query)
    return Array.from(this.searchIndex.values())
      .filter((entry) => this.matchesListOptions(entry.capability, options))
      .map((entry) => ({
        capability: entry.capability,
        score: this.score(entry, terms)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id))
      .slice(0, limit)
      .map((item) => this.toDescriptor(item.capability, options.includeSchemas === true))
  }

  private sortedCapabilities(options: AppCapabilityListOptions): AppCapabilityDefinition[] {
    return Array.from(this.capabilities.values())
      .filter((capability) => this.matchesListOptions(capability, options))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  private matchesListOptions(capability: AppCapabilityDefinition, options: AppCapabilityListOptions): boolean {
    if (!options.includeHidden && capability.hidden) return false
    if (options.domain && capability.domain !== options.domain) return false
    if (options.risk && capability.risk !== options.risk) return false
    return true
  }

  private toSearchIndexEntry(capability: AppCapabilityDefinition): SearchIndexEntry {
    const fields = [
      [normalize(capability.id), 12],
      [normalize(capability.domain), 8],
      [normalize(capability.title), 7],
      [normalize(capability.description), 4],
      [normalize((capability.tags ?? []).join(' ')), 5],
      [normalize((capability.aliases ?? []).join(' ')), 6],
      [normalize((capability.examples ?? []).join(' ')), 3]
    ] satisfies SearchIndexEntry['fields']

    return { capability, fields }
  }

  private score(entry: SearchIndexEntry, terms: string[]): number {
    let score = 0
    for (const term of terms) {
      for (const [field, weight] of entry.fields) {
        if (field === term) {
          score += weight * 2
        } else if (field.includes(term)) {
          score += weight
        }
      }
    }
    return score
  }

  private toDescriptor(capability: AppCapabilityDefinition, includeSchema: boolean): AppCapabilityDescriptor {
    const { execute, inputSchema, outputSchema, ...descriptor } = capability
    void execute
    return {
      ...descriptor,
      ...(includeSchema ? { inputSchema, outputSchema } : {})
    }
  }
}

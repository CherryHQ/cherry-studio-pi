export type AppCapabilityRisk = 'read' | 'write' | 'destructive' | 'external'

export type AppCapabilityKind = 'query' | 'command'

export type AppCapabilitySource = 'agent' | 'api' | 'ui' | 'system'

export type AppCapabilityJsonSchema = {
  type?: string
  properties?: Record<string, AppCapabilityJsonSchema>
  items?: AppCapabilityJsonSchema
  required?: string[]
  enum?: unknown[]
  description?: string
  additionalProperties?: boolean | AppCapabilityJsonSchema
  default?: unknown
  [key: string]: unknown
}

export type AppCapabilityArtifact = {
  type: string
  id?: string
  path?: string
  uri?: string
  title?: string
  metadata?: Record<string, unknown>
}

export type AppCapabilityResult<T = unknown> = {
  ok: boolean
  summary: string
  data?: T
  artifacts?: AppCapabilityArtifact[]
  warnings?: string[]
  error?: string
  isError?: boolean
}

export type AppCapabilityContext = {
  source: AppCapabilitySource
  sessionId?: string
  toolCallId?: string
  signal?: AbortSignal
  dryRun?: boolean
}

export type AppCapabilityCost = {
  token?: 'none' | 'low' | 'medium' | 'high'
  money?: 'none' | 'low' | 'medium' | 'high'
  latency?: 'instant' | 'low' | 'medium' | 'high'
}

export type AppCapabilityDefinition<Input = unknown, Output = unknown> = {
  id: string
  domain: string
  kind: AppCapabilityKind
  title: string
  description: string
  inputSchema: AppCapabilityJsonSchema
  outputSchema?: AppCapabilityJsonSchema
  risk: AppCapabilityRisk
  tags?: string[]
  aliases?: string[]
  examples?: string[]
  permissions?: string[]
  sideEffects?: string[]
  cost?: AppCapabilityCost
  supportsDryRun?: boolean
  supportsUndo?: boolean
  hidden?: boolean
  execute: (input: Input, context: AppCapabilityContext) => Promise<AppCapabilityResult<Output>>
}

export type AppCapabilityDescriptor = Omit<AppCapabilityDefinition, 'execute' | 'inputSchema' | 'outputSchema'> & {
  inputSchema?: AppCapabilityJsonSchema
  outputSchema?: AppCapabilityJsonSchema
}

export type AppCapabilityListOptions = {
  domain?: string
  risk?: AppCapabilityRisk
  includeHidden?: boolean
  includeSchemas?: boolean
}

export type AppCapabilitySearchOptions = AppCapabilityListOptions & {
  query?: string
  limit?: number
}

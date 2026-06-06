import * as z from 'zod'

export type ToolType = 'builtin' | 'provider' | 'mcp'

export interface BaseTool {
  id: string
  name: string
  description?: string
  type: ToolType
}

// export interface ToolCallResponse {
//   id: string
//   toolName: string
//   arguments: Record<string, unknown> | undefined
//   status: 'invoking' | 'completed' | 'error'
//   result?: any // AI SDK的工具执行结果
//   error?: string
//   providerExecuted?: boolean // 标识是Provider端执行还是客户端执行
// }

const JsonObjectSchema = z.object({}).loose()

export interface MCPToolInputJsonSchema {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  [key: string]: unknown
}

export type MCPToolOutputJsonSchema = Record<string, unknown>

export const MCPToolInputSchema = z
  .object({
    type: z.unknown().optional(),
    properties: JsonObjectSchema.optional(),
    required: z.array(z.string()).optional()
  })
  .loose()
  .transform((schema): MCPToolInputJsonSchema => {
    return {
      ...schema,
      type: 'object' as const,
      properties: schema.properties ?? {},
      required: schema.required ?? []
    }
  })

export const MCPToolOutputSchema: z.ZodType<MCPToolOutputJsonSchema> = JsonObjectSchema

export interface BuiltinTool extends BaseTool {
  inputSchema: MCPToolInputJsonSchema
  type: 'builtin'
}

export interface MCPTool extends BaseTool {
  id: string
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema: MCPToolInputJsonSchema
  outputSchema?: MCPToolOutputJsonSchema
  isBuiltIn?: boolean // 标识是否为内置工具，内置工具不需要通过MCP协议调用
  type: 'mcp'
}

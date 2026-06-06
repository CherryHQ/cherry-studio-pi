import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'

export type AgentPermissionUpdate = Record<string, unknown>

export type AgentRawValue =
  | ContentBlockParam
  | {
      type?: string
      session_id?: string
      slash_commands?: string[]
      tools?: string[]
      raw?: unknown
    }

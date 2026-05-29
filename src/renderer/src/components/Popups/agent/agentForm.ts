import type { AgentConfiguration, AgentEntity, BaseAgentForm, Tool } from '@renderer/types'
import { isAgentType } from '@renderer/types'
import {
  DEFAULT_AGENT_CONFIGURATION,
  parseAgentConfiguration as parseSharedAgentConfiguration
} from '@renderer/utils/agentConfiguration'
import {
  buildCherryStudioPiAgentInstructions,
  CHERRY_STUDIO_PI_AGENT_FALLBACK_NAME,
  isLegacyAgentDefaultInstructions
} from '@shared/agents/pi/constants'

export type AgentWithTools = AgentEntity & { tools?: Tool[] }

export const DEFAULT_CREATE_CONFIGURATION = DEFAULT_AGENT_CONFIGURATION

const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const stringWithFallback = (value: unknown, fallback: string): string => {
  return typeof value === 'string' ? value : fallback
}

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

export const parseAgentModalConfiguration = (value: unknown): AgentConfiguration => {
  return parseSharedAgentConfiguration(value)
}

const getInitialAgentInstructions = (existing?: AgentWithTools): string => {
  const name = stringWithFallback(existing?.name, CHERRY_STUDIO_PI_AGENT_FALLBACK_NAME)
  const instructions = optionalString(existing?.instructions)?.trim()

  if (!instructions || isLegacyAgentDefaultInstructions(instructions)) {
    return buildCherryStudioPiAgentInstructions(name)
  }

  return instructions
}

export const buildAgentForm = (existing?: AgentWithTools): BaseAgentForm => ({
  type: isAgentType(existing?.type) ? existing.type : 'claude-code',
  name: stringWithFallback(existing?.name, CHERRY_STUDIO_PI_AGENT_FALLBACK_NAME),
  description: optionalString(existing?.description),
  instructions: getInitialAgentInstructions(existing),
  model: stringWithFallback(existing?.model, ''),
  accessible_paths: stringArray(existing?.accessible_paths),
  allowed_tools: stringArray(existing?.allowed_tools),
  mcps: stringArray(existing?.mcps),
  configuration: parseAgentModalConfiguration(existing?.configuration)
})

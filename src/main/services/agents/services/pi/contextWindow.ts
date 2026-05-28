import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import type { ImageContent, Message as PiMessage, TextContent, ToolCall } from '@earendil-works/pi-ai'

const DEFAULT_OUTPUT_RESERVE = 16_384
const MIN_INPUT_BUDGET = 4_096

type ContextWindowConfig = {
  contextWindow: number
  maxTokens: number
  systemPrompt: string
  tools: AgentTool<any>[]
}

export type ContextWindowBudget = {
  inputBudget: number
  contextWindow: number
  outputReserve: number
  overheadTokens: number
  safetyTokens: number
}

const countCjk = (text: string) => {
  const matches = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)
  return matches?.length ?? 0
}

export const estimateTextTokens = (text: string): number => {
  if (!text) return 0
  const cjk = countCjk(text)
  const nonCjk = Math.max(0, text.length - cjk)
  return Math.ceil(cjk + nonCjk / 4)
}

const estimateJsonTokens = (value: unknown) => {
  try {
    return estimateTextTokens(JSON.stringify(value))
  } catch {
    return 0
  }
}

const textContentTokens = (content: TextContent | ImageContent | ToolCall): number => {
  if (content.type === 'text') return estimateTextTokens(content.text)
  if (content.type === 'image') return 1_024
  return estimateTextTokens(content.name) + estimateJsonTokens(content.arguments) + 24
}

export const estimateMessageTokens = (message: AgentMessage | PiMessage): number => {
  const overhead = 8

  if (message.role === 'user') {
    if (typeof message.content === 'string') return estimateTextTokens(message.content) + overhead
    return message.content.reduce((sum, item) => sum + textContentTokens(item), overhead)
  }

  if (message.role === 'assistant') {
    return (
      message.content.reduce((sum, item) => {
        if (item.type === 'thinking') return sum + estimateTextTokens(item.thinking)
        return sum + textContentTokens(item)
      }, overhead) + estimateTextTokens(message.errorMessage ?? '')
    )
  }

  if (message.role === 'toolResult') {
    return message.content.reduce(
      (sum, item) => sum + textContentTokens(item),
      overhead + estimateTextTokens(message.toolName)
    )
  }

  return overhead
}

export const estimateMessagesTokens = (messages: Array<AgentMessage | PiMessage>) => {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
}

const estimateToolsTokens = (tools: AgentTool<any>[]) => {
  return tools.reduce((sum, tool) => {
    return (
      sum +
      estimateTextTokens(tool.name) +
      estimateTextTokens(tool.description ?? '') +
      estimateJsonTokens(tool.parameters)
    )
  }, 0)
}

export const buildContextWindowBudget = ({
  contextWindow,
  maxTokens,
  systemPrompt,
  tools
}: ContextWindowConfig): ContextWindowBudget => {
  const outputReserve = Math.max(1_024, Math.min(maxTokens || DEFAULT_OUTPUT_RESERVE, DEFAULT_OUTPUT_RESERVE))
  const safetyTokens = Math.max(1_024, Math.ceil(contextWindow * 0.05))
  const overheadTokens = estimateTextTokens(systemPrompt) + estimateToolsTokens(tools)
  const inputBudget = Math.max(MIN_INPUT_BUDGET, contextWindow - outputReserve - overheadTokens - safetyTokens)

  return {
    inputBudget,
    contextWindow,
    outputReserve,
    overheadTokens,
    safetyTokens
  }
}

const findRequiredSuffixStart = (messages: AgentMessage[]) => {
  if (messages.length === 0) return 0

  const lastIndex = messages.length - 1
  const last = messages[lastIndex]

  if (last.role !== 'toolResult') return lastIndex

  let assistantIndex = lastIndex
  while (assistantIndex >= 0 && messages[assistantIndex].role === 'toolResult') {
    assistantIndex -= 1
  }

  if (assistantIndex < 0 || messages[assistantIndex].role !== 'assistant') {
    return lastIndex
  }

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index
  }

  return assistantIndex
}

const removeInvalidLeadingMessages = (messages: AgentMessage[]) => {
  let start = 0
  while (start < messages.length - 1 && messages[start].role !== 'user') {
    start += 1
  }
  return start === 0 ? messages : messages.slice(start)
}

export const trimMessagesToBudget = (messages: AgentMessage[], budget: ContextWindowBudget): AgentMessage[] => {
  if (messages.length === 0) return messages

  const totalTokens = estimateMessagesTokens(messages)
  if (totalTokens <= budget.inputBudget) return messages

  const requiredStart = findRequiredSuffixStart(messages)
  const requiredSuffix = messages.slice(requiredStart)
  const selected = [...requiredSuffix]
  let usedTokens = estimateMessagesTokens(requiredSuffix)

  for (let index = requiredStart - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const messageTokens = estimateMessageTokens(message)
    if (usedTokens + messageTokens > budget.inputBudget && selected.length > 0) break
    selected.unshift(message)
    usedTokens += messageTokens
  }

  const cleaned = removeInvalidLeadingMessages(selected)
  return cleaned.length > 0 ? cleaned : messages.slice(-1)
}

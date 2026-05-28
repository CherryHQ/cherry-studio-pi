import { loggerService } from '@logger'
import type { Assistant } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'

import { getAssistantSettings } from './AssistantService'
import { type ModelTokenLimits, resolveModelTokenLimits } from './ModelTokenLimitService'
import { estimateMessageUsage, estimateTextTokens } from './TokenService'

const logger = loggerService.withContext('ChatContextService')

const DEFAULT_OUTPUT_RESERVE = 4_096
const MAX_SAFETY_BUFFER = 1_024
const MIN_SAFETY_BUFFER = 32

export type ChatContextBudgetStats = {
  budget: number
  totalTokens: number
  removedMessages: number
  promptTokens: number
  outputReserve: number
  safetyBuffer: number
  limits: ModelTokenLimits
}

export type ChatContextBudgetResult = {
  messages: Message[]
  stats: ChatContextBudgetStats
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function getSafetyBuffer(contextWindow: number): number {
  return Math.min(MAX_SAFETY_BUFFER, Math.max(MIN_SAFETY_BUFFER, Math.floor(contextWindow * 0.02)))
}

function getOutputReserve(limits: ModelTokenLimits, assistant: Assistant): number {
  const { maxTokens } = getAssistantSettings(assistant)
  const defaultReserve = Math.min(limits.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE, DEFAULT_OUTPUT_RESERVE)
  const requestedReserve = positiveInteger(maxTokens) ?? defaultReserve
  const maxReserve = Math.max(1, Math.floor(limits.effectiveContextWindow * 0.4))

  return Math.max(1, Math.min(requestedReserve, maxReserve))
}

function getMessageUsageTokens(message: Message): number | undefined {
  if (!message.usage) return undefined

  if (message.role === 'assistant') {
    return positiveInteger(message.usage.completion_tokens) ?? positiveInteger(message.usage.total_tokens)
  }

  return positiveInteger(message.usage.total_tokens) ?? positiveInteger(message.usage.prompt_tokens)
}

async function estimateMessageContextTokens(message: Message): Promise<number> {
  const usageTokens = getMessageUsageTokens(message)
  if (usageTokens !== undefined) return usageTokens

  const usage = await estimateMessageUsage(message)
  return message.role === 'assistant' ? usage.completion_tokens || usage.total_tokens : usage.total_tokens
}

function removeFirst(
  entries: Array<{ message: Message; tokens: number }>,
  stats: { totalTokens: number; removed: number }
) {
  const removed = entries.shift()
  if (!removed) return

  stats.totalTokens -= removed.tokens
  stats.removed += 1
}

async function selectRecentMessageEntries(messages: Message[], budget: number) {
  const entries: Array<{ message: Message; tokens: number }> = []
  let totalTokens = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const tokens = await estimateMessageContextTokens(message)

    if (entries.length > 0 && totalTokens + tokens > budget) {
      break
    }

    entries.unshift({ message, tokens })
    totalTokens += tokens

    if (totalTokens >= budget) {
      break
    }
  }

  return {
    entries,
    totalTokens,
    removed: messages.length - entries.length
  }
}

export async function applyChatContextBudget(
  messages: Message[],
  assistant: Assistant
): Promise<ChatContextBudgetResult> {
  if (messages.length === 0) {
    const limits = resolveModelTokenLimits(assistant.model || assistant.defaultModel)
    const promptTokens = estimateTextTokens(assistant.prompt || '')
    const outputReserve = getOutputReserve(limits, assistant)
    const safetyBuffer = getSafetyBuffer(limits.effectiveContextWindow)

    return {
      messages,
      stats: {
        budget: Math.max(1, limits.effectiveContextWindow - outputReserve - safetyBuffer - promptTokens),
        totalTokens: 0,
        removedMessages: 0,
        promptTokens,
        outputReserve,
        safetyBuffer,
        limits
      }
    }
  }

  const limits = resolveModelTokenLimits(assistant.model || assistant.defaultModel)
  const promptTokens = estimateTextTokens(assistant.prompt || '')
  const outputReserve = getOutputReserve(limits, assistant)
  const safetyBuffer = getSafetyBuffer(limits.effectiveContextWindow)
  const contextBudget = limits.effectiveContextWindow - outputReserve - safetyBuffer - promptTokens
  const inputBudget =
    limits.maxInputTokens !== undefined ? limits.maxInputTokens - safetyBuffer - promptTokens : Number.POSITIVE_INFINITY
  const budget = Math.max(1, Math.min(contextBudget, inputBudget))
  const selection = await selectRecentMessageEntries(messages, budget)
  const entries = selection.entries
  const stats = {
    totalTokens: selection.totalTokens,
    removed: selection.removed
  }

  while (entries.length > 1 && entries[0]?.message.role === 'assistant') {
    removeFirst(entries, stats)
  }

  if (stats.removed > 0) {
    logger.debug('Applied chat context budget', {
      budget,
      totalTokens: stats.totalTokens,
      removedMessages: stats.removed,
      promptTokens,
      outputReserve,
      safetyBuffer,
      modelId: assistant.model?.id,
      limitSource: limits.source
    })
  }

  return {
    messages: entries.map((entry) => entry.message),
    stats: {
      budget,
      totalTokens: stats.totalTokens,
      removedMessages: stats.removed,
      promptTokens,
      outputReserve,
      safetyBuffer,
      limits
    }
  }
}

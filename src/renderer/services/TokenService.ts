import type { Message } from '@renderer/types/newMessage'
import { estimateTokenCount } from 'tokenx'

export function estimateTextTokens(text: string): number {
  return estimateTokenCount(text || '')
}

function getPartText(part: unknown): string {
  if (!part || typeof part !== 'object') return ''

  const record = part as Record<string, unknown>
  const text = record.text ?? record.content

  if (typeof text === 'string') return text
  if (text && typeof text === 'object') return JSON.stringify(text)

  return ''
}

export async function estimateMessageUsage(message: Message) {
  const legacyContent = (message as unknown as { content?: unknown }).content
  const contentText =
    typeof legacyContent === 'string'
      ? legacyContent
      : Array.isArray(message.parts)
        ? message.parts.map(getPartText).join('\n')
        : ''
  const totalTokens = estimateTextTokens(contentText)

  return {
    prompt_tokens: message.role === 'assistant' ? 0 : totalTokens,
    completion_tokens: message.role === 'assistant' ? totalTokens : 0,
    total_tokens: totalTokens
  }
}

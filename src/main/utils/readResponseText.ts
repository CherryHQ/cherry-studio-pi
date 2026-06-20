export type LimitedResponseText = {
  text: string
  truncated: boolean
  bytesRead: number
}

export const DEFAULT_MAX_RESPONSE_TEXT_BYTES = 2 * 1024 * 1024

export async function readResponseTextWithinLimit(
  response: Pick<Response, 'body' | 'text'>,
  maxBytes = DEFAULT_MAX_RESPONSE_TEXT_BYTES
): Promise<LimitedResponseText> {
  const limit = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : DEFAULT_MAX_RESPONSE_TEXT_BYTES

  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text()
    if (text.length <= limit) {
      return { text, truncated: false, bytesRead: Buffer.byteLength(text) }
    }
    return { text: text.slice(0, limit), truncated: true, bytesRead: Buffer.byteLength(text.slice(0, limit)) }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytesRead = 0
  let truncated = false

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      const remainingBytes = limit - bytesRead
      if (remainingBytes <= 0) {
        truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }

      if (value.byteLength > remainingBytes) {
        text += decoder.decode(value.slice(0, remainingBytes), { stream: true })
        bytesRead += remainingBytes
        truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }

      text += decoder.decode(value, { stream: true })
      bytesRead += value.byteLength
    }

    text += decoder.decode()
    return { text, truncated, bytesRead }
  } finally {
    reader.releaseLock()
  }
}

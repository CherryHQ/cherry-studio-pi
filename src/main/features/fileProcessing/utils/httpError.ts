const DEFAULT_RESPONSE_BODY_PREVIEW_BYTES = 4096

export async function readResponseBodyPreview(
  response: Response,
  maxBytes = DEFAULT_RESPONSE_BODY_PREVIEW_BYTES
): Promise<string> {
  if (!response.body || maxBytes <= 0) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let truncated = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      const chunk = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value))
      const remainingBytes = maxBytes - totalBytes

      if (chunk.byteLength > remainingBytes) {
        if (remainingBytes > 0) {
          chunks.push(chunk.slice(0, remainingBytes))
          totalBytes += remainingBytes
        }
        truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }

      chunks.push(chunk)
      totalBytes += chunk.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const preview = new TextDecoder().decode(concatUint8Arrays(chunks)).trim()
  if (!truncated) return preview
  return preview ? `${preview}... [truncated]` : '[truncated]'
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result
}

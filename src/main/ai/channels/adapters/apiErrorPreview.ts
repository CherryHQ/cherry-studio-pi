import { readResponseTextWithinLimit } from '@main/utils/readResponseText'

export const CHANNEL_API_ERROR_TEXT_MAX_BYTES = 4 * 1024

export async function readChannelApiErrorText(response: Response): Promise<string> {
  const { text, truncated } = await readResponseTextWithinLimit(response, CHANNEL_API_ERROR_TEXT_MAX_BYTES)
  const preview = text.trim()
  return truncated ? `${preview}\n[truncated]` : preview
}

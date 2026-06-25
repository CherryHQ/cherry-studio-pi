import type { SerializedError } from '@shared/types/error'

import { IpcError } from '../errors'

/**
 * AI domain IpcApi error codes. Import directly from this module on both sides.
 */
export const aiErrorCodes = {
  /**
   * A provider / AI SDK call failed. The full serialized provider error rides
   * in `IpcError.data` so the renderer can show useful model/provider details.
   */
  AI_REQUEST_FAILED: 'AI_REQUEST_FAILED'
} as const

export function aiErrorDetail(e: unknown): SerializedError | undefined {
  return e instanceof IpcError && e.code === aiErrorCodes.AI_REQUEST_FAILED ? (e.data as SerializedError) : undefined
}

import { AISDKError } from 'ai'

const name = 'AI_ProviderSpecificError'
const marker = `vercel.ai.error.${name}`
const symbol: unique symbol = Symbol.for(marker) as never

export class ProviderSpecificError extends AISDKError {
  readonly [symbol] = true // used in isInstance

  readonly provider: string

  constructor({
    message,
    provider,
    cause
  }: {
    message: string
    provider: string
    cause?: unknown
  }) {
    super({ name, message, cause })
    this.provider = provider
  }

  static isInstance(error: unknown): error is ProviderSpecificError {
    return AISDKError.hasMarker(error, marker)
  }
}

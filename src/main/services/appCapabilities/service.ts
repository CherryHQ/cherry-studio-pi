import { loggerService } from '@logger'

import { registerAppCapabilities } from './providers'
import { AppCapabilityRegistry } from './registry'
import type {
  AppCapabilityContext,
  AppCapabilityDescriptor,
  AppCapabilityListOptions,
  AppCapabilityResult,
  AppCapabilitySearchOptions
} from './types'
import { redactAgentText, sanitizeAppCapabilityResultForAgent } from './utils'

const logger = loggerService.withContext('AppCapabilityService')
const DEFAULT_ABORT_REASON = '能力调用已取消。'
const INVALID_RESULT_EXPECTED_OBJECT_REASON = '应返回对象'
const INVALID_RESULT_MISSING_OK_REASON = '缺少布尔值 ok'
const INVALID_RESULT_INFIX = ' 返回了无效结果：'
const CAPABILITY_NOT_FOUND_PREFIX = '未找到能力：'
const CAPABILITY_COMPLETED_SUFFIX = ' 已完成'
const CAPABILITY_FAILED_SUFFIX = ' 调用失败'
const CAPABILITY_FAILED_INFIX = ' 调用失败：'
const CAPABILITY_ABORTED_INFIX = ' 已取消：'
const DRY_RUN_UNSUPPORTED_PREFIX = '能力不支持 dry run：'
const UNKNOWN_CAPABILITY_ERROR = 'Unknown capability error'

function abortReasonMessage(signal: AbortSignal) {
  const reason = signal.reason
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason.trim()
  return DEFAULT_ABORT_REASON
}

function abortReasonError(signal: AbortSignal) {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  return new Error(abortReasonMessage(signal))
}

function getCapabilityErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (!error || typeof error !== 'object') return UNKNOWN_CAPABILITY_ERROR

  const nestedError = (error as { error?: unknown }).error
  if (nestedError) {
    const nestedMessage = getCapabilityErrorMessage(nestedError)
    if (nestedMessage !== UNKNOWN_CAPABILITY_ERROR) return nestedMessage
  }

  const message = (error as { message?: unknown }).message
  if (typeof message === 'string' && message.trim()) return message

  return UNKNOWN_CAPABILITY_ERROR
}

function createAbortWait(signal: AbortSignal) {
  let disposed = false
  let abortListener: (() => void) | undefined

  const promise = new Promise<never>((_, reject) => {
    abortListener = () => reject(abortReasonError(signal))
    if (signal.aborted) {
      abortListener()
      return
    }
    signal.addEventListener('abort', abortListener, { once: true })
  })

  const dispose = () => {
    if (disposed) return
    disposed = true
    if (abortListener) signal.removeEventListener('abort', abortListener)
  }

  return { promise, dispose }
}

function sanitizeResultForSource<T>(
  result: AppCapabilityResult<T>,
  source: AppCapabilityContext['source']
): AppCapabilityResult<T> {
  if (source !== 'agent') return result
  return sanitizeAppCapabilityResultForAgent(result)
}

function invalidCapabilityResult<T>(capabilityId: string, reason: string): AppCapabilityResult<T> {
  const message = capabilityId + INVALID_RESULT_INFIX + reason
  return {
    ok: false,
    isError: true,
    summary: message,
    error: message
  }
}

function normalizeCapabilityResult<T>(capabilityId: string, result: unknown): AppCapabilityResult<T> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return invalidCapabilityResult(capabilityId, INVALID_RESULT_EXPECTED_OBJECT_REASON)
  }

  const candidate = result as Partial<AppCapabilityResult<T>>
  if (typeof candidate.ok !== 'boolean') {
    return invalidCapabilityResult(capabilityId, INVALID_RESULT_MISSING_OK_REASON)
  }

  const summary =
    typeof candidate.summary === 'string' && candidate.summary.trim()
      ? candidate.summary
      : candidate.ok
        ? capabilityId + CAPABILITY_COMPLETED_SUFFIX
        : typeof candidate.error === 'string' && candidate.error.trim()
          ? capabilityId + CAPABILITY_FAILED_INFIX + candidate.error
          : capabilityId + CAPABILITY_FAILED_SUFFIX

  const normalizedCandidate = { ...candidate }
  delete normalizedCandidate.isError

  return {
    ...normalizedCandidate,
    ok: candidate.ok,
    summary,
    ...(candidate.ok ? {} : { isError: true })
  } as AppCapabilityResult<T>
}

export class AppCapabilityService {
  private readonly registry = new AppCapabilityRegistry()
  private initialized = false

  private ensureInitialized() {
    if (this.initialized) return
    registerAppCapabilities(this.registry)
    this.initialized = true
  }

  list(options: AppCapabilityListOptions = {}): AppCapabilityDescriptor[] {
    this.ensureInitialized()
    return this.registry.list(options)
  }

  search(options: AppCapabilitySearchOptions = {}): AppCapabilityDescriptor[] {
    this.ensureInitialized()
    return this.registry.search(options)
  }

  get(id: string, options: Pick<AppCapabilityListOptions, 'includeHidden' | 'includeSchemas'> = {}) {
    this.ensureInitialized()
    return this.registry.getDescriptor(id, options)
  }

  async call<T = unknown>(
    id: string,
    input: unknown = {},
    context: Partial<AppCapabilityContext> = {}
  ): Promise<AppCapabilityResult<T>> {
    this.ensureInitialized()
    const capabilityId = String(id ?? '').trim()
    const displayCapabilityId = capabilityId || '(empty)'
    const capability = this.registry.get(capabilityId)
    if (!capability) {
      return sanitizeResultForSource(
        {
          ok: false,
          isError: true,
          summary: CAPABILITY_NOT_FOUND_PREFIX + displayCapabilityId,
          error: CAPABILITY_NOT_FOUND_PREFIX + displayCapabilityId
        },
        context.source ?? 'system'
      )
    }

    if (context.signal?.aborted) {
      const message = abortReasonMessage(context.signal)
      return sanitizeResultForSource(
        {
          ok: false,
          isError: true,
          summary: capabilityId + CAPABILITY_ABORTED_INFIX + message,
          error: message
        },
        context.source ?? 'system'
      )
    }

    if (context.dryRun === true && capability.risk !== 'read' && capability.supportsDryRun !== true) {
      const message = DRY_RUN_UNSUPPORTED_PREFIX + displayCapabilityId
      return sanitizeResultForSource(
        {
          ok: false,
          isError: true,
          summary: message,
          error: message
        },
        context.source ?? 'system'
      )
    }

    try {
      logger.info('Calling app capability', {
        id: capabilityId,
        source: context.source ?? 'system',
        risk: capability.risk,
        dryRun: context.dryRun === true
      })
      const abortWait = context.signal ? createAbortWait(context.signal) : null
      let rawResult: unknown
      try {
        const execution = capability.execute(input, {
          source: context.source ?? 'system',
          sessionId: context.sessionId,
          toolCallId: context.toolCallId,
          signal: context.signal,
          dryRun: context.dryRun
        })
        rawResult = abortWait ? await Promise.race([execution, abortWait.promise]) : await execution
      } finally {
        abortWait?.dispose()
      }
      const result = normalizeCapabilityResult<T>(capabilityId, rawResult)
      if (context.signal?.aborted) {
        const message = abortReasonMessage(context.signal)
        return sanitizeResultForSource(
          {
            ok: false,
            isError: true,
            summary: capabilityId + CAPABILITY_ABORTED_INFIX + message,
            error: message
          },
          context.source ?? 'system'
        )
      }
      return sanitizeResultForSource(result, context.source ?? 'system')
    } catch (error) {
      if (context.signal?.aborted) {
        const message = abortReasonMessage(context.signal)
        return sanitizeResultForSource(
          {
            ok: false,
            isError: true,
            summary: capabilityId + CAPABILITY_ABORTED_INFIX + message,
            error: message
          },
          context.source ?? 'system'
        )
      }

      const message = getCapabilityErrorMessage(error)
      logger.warn('App capability failed', { id: capabilityId, error: redactAgentText(message) })
      return sanitizeResultForSource(
        {
          ok: false,
          isError: true,
          summary: capabilityId + CAPABILITY_FAILED_INFIX + message,
          error: message
        },
        context.source ?? 'system'
      )
    }
  }
}

export const appCapabilityService = new AppCapabilityService()

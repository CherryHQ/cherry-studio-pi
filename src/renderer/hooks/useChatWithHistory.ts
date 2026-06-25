import { Chat, useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { ChatRequestOptions, FileUIPart } from 'ai'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useTopicDbRefreshOnTerminal } from './useTopicStreamStatus'
import { useTopicStreamStatus } from './useTopicStreamStatus'

const logger = loggerService.withContext('useChatWithHistory')

const EMPTY_EXECUTIONS: readonly ActiveExecution[] = Object.freeze([])

// ── Return type ──

export interface UseChatWithHistoryResult {
  sendMessage: (message?: { text: string; files?: FileUIPart[] }, options?: ChatRequestOptions) => Promise<void>
  regenerate: (options?: ChatRequestOptions & { messageId?: string }) => Promise<void>
  stop: () => Promise<void>
  error: Error | undefined
  status: ReturnType<typeof useChat<CherryUIMessage>>['status']
  setMessages: (messages: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => void
  activeExecutions: readonly ActiveExecution[]
  chat: Chat<CherryUIMessage>
}

// ── Hook ──

export function useChatWithHistory(
  topicId: string,
  initialMessages: CherryUIMessage[],
  refresh: () => Promise<CherryUIMessage[]>
): UseChatWithHistoryResult {
  const initialMessagesRef = useRef(initialMessages)
  initialMessagesRef.current = initialMessages

  const chat = useMemo<Chat<CherryUIMessage>>(
    () =>
      new Chat<CherryUIMessage>({
        id: topicId,
        transport: ipcChatTransport,
        messages: initialMessagesRef.current,
        onError: (streamError) => {
          logger.error('AI stream error', { topicId, streamError })
        }
      }),
    [topicId]
  )

  const {
    setMessages,
    stop: sdkStop,
    status,
    error,
    sendMessage,
    regenerate,
    resumeStream
  } = useChat<CherryUIMessage>({
    chat,
    experimental_throttle: 0
  })

  const stop = useCallback(async () => {
    void ipcApi.request('ai.stream_abort', { topicId }).catch((err) => {
      logger.warn('streamAbort failed', { topicId, err })
    })
    await sdkStop()
  }, [sdkStop, topicId])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const { status: topicStreamStatus, activeExecutions: liveExecutions } = useTopicStreamStatus(topicId)
  const activeExecutions = liveExecutions.length > 0 ? liveExecutions : EMPTY_EXECUTIONS

  const resumeInFlightRef = useRef<Promise<void> | null>(null)

  const resumeActiveStream = useCallback(
    (reason: 'mount' | 'started-event') => {
      if (reason === 'mount' && (status === 'streaming' || status === 'submitted')) return
      if (resumeInFlightRef.current) return

      resumeInFlightRef.current = (async () => {
        if (reason === 'started-event') {
          try {
            await refreshRef.current()
          } catch (err) {
            logger.warn('Failed to refresh messages before resuming stream', { topicId, err })
          }
        }

        if (status === 'streaming' || status === 'submitted') {
          return
        }

        await resumeStream()
      })()
        .catch((err) => {
          logger.warn('Failed to resume active stream', { topicId, reason, err })
        })
        .finally(() => {
          resumeInFlightRef.current = null
        })
    },
    [resumeStream, status, topicId]
  )

  useEffect(() => {
    resumeActiveStream('mount')
  }, [resumeActiveStream])

  // Single invalidation signal — extracted into a dedicated hook so the
  // "DB re-read on any terminal transition" architecture is visible at the
  // import. Classifier-driven, so `awaiting-approval` participates without
  // an explicit `=== 'awaiting-approval'` gate here (or anywhere else).
  useTopicDbRefreshOnTerminal(topicId, refresh)

  // Resume-on-pending — distinct purpose from the invalidation signal: it
  // re-attaches a stream that started while this window was unmounted /
  // reloading. Stays here (it's tightly coupled to `resumeActiveStream` and
  // chat-specific) rather than mingling with the generic invalidation gate.
  const prevTopicStatusRef = useRef<{ topicId: string; status: typeof topicStreamStatus } | undefined>(undefined)
  useEffect(() => {
    const prev = prevTopicStatusRef.current
    const prevStatus = prev?.topicId === topicId ? prev.status : undefined
    prevTopicStatusRef.current = { topicId, status: topicStreamStatus }
    if (topicStreamStatus === 'pending' && prevStatus !== 'pending') {
      resumeActiveStream('started-event')
    }
  }, [resumeActiveStream, topicId, topicStreamStatus])

  useEffect(() => {
    const errorUnsub = ipcApi.on('ai.stream_error', (data) => {
      if (data.topicId !== topicId) return
      void refreshRef.current().catch((err) => {
        logger.warn('Failed to refresh messages after stream error', { topicId, err })
      })
    })
    return () => {
      errorUnsub()
    }
  }, [topicId])

  return {
    sendMessage,
    regenerate,
    stop,
    error,
    status,
    setMessages,
    activeExecutions,
    chat
  }
}

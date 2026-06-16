import { Flex } from '@cherrystudio/ui'
import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { CopyIcon } from '@renderer/components/Icons'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useIsToolAutoApproved } from '@renderer/hooks/useMcpServer'
import { useTimer } from '@renderer/hooks/useTimer'
import type { McpToolResponse } from '@renderer/types'
import { createDataImageUri } from '@renderer/utils/dataImage'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { renderPlainTextCodeHtml, sanitizeHtml } from '@renderer/utils/html'
import type { McpProgressEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { Collapse, ConfigProvider, Progress } from 'antd'
import { Check, ChevronRight, ShieldCheck } from 'lucide-react'
import { parse as parsePartialJson } from 'partial-json'
import type { FC } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useToolApproval } from './hooks/useToolApproval'
import {
  getEffectiveStatus,
  SkeletonSpan,
  ToolStatusIndicator,
  TruncatedIndicator
} from './MessageAgentTools/GenericTools'
import {
  ArgKey,
  ArgsSection,
  ArgsSectionTitle,
  ArgsTable,
  ArgValue,
  formatArgValue,
  ResponseSection
} from './shared/ArgsTable'
import { truncateOutput } from './shared/truncateOutput'
import ToolApprovalActionsComponent from './ToolApprovalActions'

interface Props {
  toolResponse: McpToolResponse
}

const logger = loggerService.withContext('MessageTools')

const MessageMcpTool: FC<Props> = ({ toolResponse }) => {
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})
  const { t } = useTranslation()
  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const [progress, setProgress] = useState<number>(0)
  const { setTimeoutTimer } = useTimer()

  const { id, tool, status, response, partialArguments } = toolResponse
  const approval = useToolApproval(toolResponse, tool)
  const autoApproved = useIsToolAutoApproved(tool)
  const isPending = status === 'pending'
  const isDone = status === 'done'
  const isError = status === 'error'
  const isCancelled = status === 'cancelled'
  const isStreaming = status === 'streaming'
  const willAwaitApproval = approval.isWaiting || (!autoApproved && status === 'invoking')

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(
      IpcChannel.Mcp_Progress,
      (_event: Electron.IpcRendererEvent, data: McpProgressEvent) => {
        // Only update progress if this event is for our specific tool call
        if (data.callId === id) {
          setProgress(data.progress)
        }
      }
    )
    return () => {
      setProgress(0)
      removeListener()
    }
  }, [id])

  // Auto-expand when pending (waiting for approval) or streaming, auto-collapse when done
  useEffect(() => {
    if (isStreaming || isPending) {
      // Expand when streaming starts or waiting for approval
      setActiveKeys((prev) => (prev.includes(id) ? prev : [...prev, id]))
    } else if (isDone || isError || isCancelled) {
      // Collapse when streaming ends
      setActiveKeys((prev) => prev.filter((key) => key !== id))
    }
  }, [isStreaming, isDone, isError, isCancelled, id, isPending])

  const copyContent = async (content: string, toolId: string) => {
    try {
      await navigator.clipboard.writeText(content)
      window.toast.success({ title: t('message.copied'), key: 'copy-message' })
      setCopiedMap((prev) => ({ ...prev, [toolId]: true }))
      setTimeoutTimer('copyContent', () => setCopiedMap((prev) => ({ ...prev, [toolId]: false })), 2000)
    } catch (error) {
      logger.error('Failed to copy MCP tool response:', error as Error)
      window.toast.error(formatErrorMessageWithPrefix(error, t('common.copy_failed')))
    }
  }

  const handleCollapseChange = (keys: string | string[]) => {
    setActiveKeys(Array.isArray(keys) ? keys : [keys])
  }

  const handleAbortTool = async () => {
    if (toolResponse?.id) {
      try {
        const success = await window.api.mcp.abortTool(toolResponse.id)
        if (success) {
          window.toast.success(t('message.tools.aborted'))
        } else {
          window.toast.error(t('message.tools.abort_failed'))
        }
      } catch (error) {
        logger.error('Failed to abort tool:', error as Error)
        window.toast.error(t('message.tools.abort_failed'))
      }
    }
  }

  // Format tool responses for collapse items
  const getCollapseItems = (): { key: string; label: React.ReactNode; children: React.ReactNode }[] => {
    const items: { key: string; label: React.ReactNode; children: React.ReactNode }[] = []
    const hasError = response?.isError === true
    const result = {
      params: toolResponse.arguments,
      response: toolResponse.response
    }
    items.push({
      key: id,
      label: (
        <MessageTitleLabel>
          <TitleContent>
            <ToolName className="items-center gap-1">
              {tool.serverName} : {tool.name}
              {autoApproved && (
                <Tooltip content={t('message.tools.autoApproveEnabled')}>
                  <ShieldCheck size={14} color="var(--status-color-success)" />
                </Tooltip>
              )}
            </ToolName>
          </TitleContent>
          <ActionButtonsContainer>
            {progress > 0 ? (
              <Progress type="circle" size={14} percent={Number((progress * 100)?.toFixed(0))} />
            ) : (
              <ToolStatusIndicator status={getEffectiveStatus(status, willAwaitApproval)} hasError={hasError} />
            )}
            {!isPending && (
              <Tooltip content={t('common.copy')} delay={500}>
                <ActionButton
                  className="message-action-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void copyContent(JSON.stringify(result, null, 2), id)
                  }}
                  aria-label={t('common.copy')}>
                  {!copiedMap[id] && <CopyIcon size={14} />}
                  {copiedMap[id] && <Check size={14} color="var(--status-color-success)" />}
                </ActionButton>
              </Tooltip>
            )}
          </ActionButtonsContainer>
        </MessageTitleLabel>
      ),
      children: (
        <ToolResponseContainer
          style={{
            fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
            fontSize
          }}>
          <ToolResponseContent
            isExpanded={activeKeys.includes(id)}
            args={isStreaming ? partialArguments : toolResponse.arguments}
            isStreaming={!!isStreaming}
            response={isDone || isError ? toolResponse.response : undefined}
          />
        </ToolResponseContainer>
      )
    })

    return items
  }

  return (
    <>
      <ConfigProvider
        theme={{
          components: {
            Button: {
              borderRadiusSM: 6
            }
          }
        }}>
        <ToolContainer>
          <ToolContentWrapper className={isPending || approval.isWaiting ? 'pending' : status}>
            <CollapseContainer
              ghost
              activeKey={activeKeys}
              size="small"
              onChange={handleCollapseChange}
              className="message-tools-container"
              items={getCollapseItems()}
              expandIconPosition="end"
              expandIcon={({ isActive }) => (
                <ExpandIcon $isActive={isActive} size={18} color="var(--color-text-3)" strokeWidth={1.5} />
              )}
            />
            {(isPending || approval.isWaiting || approval.isExecuting) && (
              <ActionsBar>
                <ActionLabel>
                  {willAwaitApproval
                    ? t('settings.mcp.tools.autoApprove.tooltip.confirm')
                    : t('message.tools.invoking')}
                </ActionLabel>

                <ToolApprovalActionsComponent
                  {...approval}
                  showAbort={approval.isExecuting && !!toolResponse?.id}
                  onAbort={handleAbortTool}
                />
              </ActionsBar>
            )}
          </ToolContentWrapper>
        </ToolContainer>
      </ConfigProvider>
    </>
  )
}

type ExtractedContent = {
  text: string
  images: Array<{ src: string }>
}

/**
 * Extract preview content from MCP tool response using SDK schema
 */
const extractPreviewContent = (response: unknown): ExtractedContent => {
  if (!response) return { text: '', images: [] }

  const result = CallToolResultSchema.safeParse(response)
  if (result.success) {
    const contents = result.data.content
    if (contents.length === 0) return { text: '', images: [] }

    const textParts: string[] = []
    const images: Array<{ src: string }> = []
    for (const content of contents) {
      switch (content.type) {
        case 'text':
          if (content.text) {
            try {
              const parsed = JSON.parse(content.text)
              textParts.push(JSON.stringify(parsed, null, 2))
            } catch {
              textParts.push(content.text)
            }
          }
          break
        case 'image':
          if (content.data) {
            const src = createDataImageUri(content.data, content.mimeType ?? 'image/png')
            if (src) {
              images.push({ src })
            }
          }
          break
        case 'resource':
          textParts.push(`[Resource: ${content.resource?.uri ?? 'unknown'}]`)
          break
      }
    }
    return { text: textParts.join('\n\n'), images }
  }

  // Fallback: return JSON string for unknown format
  return { text: JSON.stringify(response, null, 2), images: [] }
}

// Unified tool response content component
const ToolResponseContent: FC<{
  isExpanded: boolean
  args: string | Record<string, unknown> | Record<string, unknown>[] | undefined
  isStreaming: boolean
  response?: unknown
}> = ({ isExpanded, args, isStreaming, response }) => {
  const { highlightCode } = useCodeStyle()
  const [highlightedResponse, setHighlightedResponse] = useState<string>('')
  const [responseImages, setResponseImages] = useState<Array<{ src: string }>>([])
  const [isTruncated, setIsTruncated] = useState(false)
  const [originalLength, setOriginalLength] = useState(0)

  // Parse args if it's a string (streaming partial JSON)
  const parsedArgs = useMemo(() => {
    if (!args) return null
    if (typeof args === 'string') {
      try {
        return parsePartialJson(args)
      } catch {
        return null
      }
    }
    return args
  }, [args])

  // Extract and highlight response when available
  useEffect(() => {
    if (!isExpanded || !response) return
    let cancelled = false

    const highlight = async () => {
      const { text: previewContent, images } = extractPreviewContent(response)
      if (cancelled) return

      setResponseImages(images)
      const {
        data: truncatedContent,
        isTruncated: wasTruncated,
        originalLength: origLen
      } = truncateOutput(previewContent)
      setIsTruncated(wasTruncated)
      setOriginalLength(origLen)
      try {
        const result = await highlightCode(truncatedContent, 'json')
        if (!cancelled) setHighlightedResponse(sanitizeHtml(result))
      } catch {
        if (!cancelled) setHighlightedResponse(renderPlainTextCodeHtml(truncatedContent))
      }
    }

    const timer = setTimeout(highlight, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isExpanded, response, highlightCode])

  if (!isExpanded) return null

  // Handle both object and array args - for arrays, show as single entry
  const getEntries = (): Array<[string, unknown]> => {
    if (!parsedArgs || typeof parsedArgs !== 'object') return []
    if (Array.isArray(parsedArgs)) {
      return [['arguments', parsedArgs]]
    }
    return Object.entries(parsedArgs)
  }
  const entries = getEntries()

  const renderArgsTable = (): React.ReactNode => {
    if (entries.length === 0) return null
    return (
      <ArgsSection>
        <ArgsSectionTitle>Arguments</ArgsSectionTitle>
        <ArgsTable>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key}>
                <ArgKey>{key}</ArgKey>
                <ArgValue>{formatArgValue(value)}</ArgValue>
              </tr>
            ))}
            {isStreaming && (
              <tr>
                <ArgKey>
                  <SkeletonSpan width="60px" />
                </ArgKey>
                <ArgValue>
                  <SkeletonSpan width="120px" />
                </ArgValue>
              </tr>
            )}
          </tbody>
        </ArgsTable>
      </ArgsSection>
    )
  }

  return (
    <div>
      {/* Arguments Table */}
      {renderArgsTable()}

      {/* Response */}
      {response !== undefined && response !== null && (highlightedResponse || responseImages.length > 0) && (
        <ResponseSection>
          <ArgsSectionTitle>Response</ArgsSectionTitle>
          {highlightedResponse && (
            <MarkdownContainer className="markdown" dangerouslySetInnerHTML={{ __html: highlightedResponse }} />
          )}
          {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
          {responseImages.map((img, idx) => (
            <img key={idx} src={img.src} alt="Tool output" style={{ maxWidth: 300, borderRadius: 4, marginTop: 8 }} />
          ))}
        </ResponseSection>
      )}
    </div>
  )
}

const ToolContentWrapper = styled.div`
  padding: 0;
  border-radius: 10px;
  overflow: hidden;
  width: 100%;
  max-width: 100%;

  .ant-collapse {
    border: 0.5px solid var(--color-border);
    border-radius: 10px;
    width: 100%;
  }

  &.pending {
    background-color: var(--color-background-soft);
    .ant-collapse {
      border: none;
    }
  }
`

const ActionsBar = styled.div`
  padding: 8px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`

const ActionLabel = styled.div`
  flex: 1;
  font-size: 14px;
  color: var(--color-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ExpandIcon = styled(ChevronRight)<{ $isActive?: boolean }>`
  transition: transform 0.2s;
  transform: ${({ $isActive }) => ($isActive ? 'rotate(90deg)' : 'rotate(0deg)')};
`

const CollapseContainer = styled(Collapse)`
  --status-color-warning: var(--color-status-warning, #faad14);
  --status-color-invoking: var(--color-primary);
  --status-color-error: var(--color-status-error, #ff4d4f);
  --status-color-success: var(--color-primary, green);
  width: 100%;
  max-width: 100%;
  border-radius: 10px;
  border: none;
  background-color: var(--color-background);
  overflow: hidden;

  .ant-collapse-header {
    padding: 5px 0 5px 10px !important;
    align-items: center !important;
  }

  .ant-collapse-expand-icon {
    height: 30px !important;
    width: 40px;
    padding: 0 !important;
    margin-inline-start: 0 !important;
    color: var(--color-text-3) !important;
    display: flex !important;
    align-items: center;
    justify-content: center;
  }

  .ant-collapse-content-box {
    padding: 0 !important;
  }
`

const ToolContainer = styled.div`
  width: 100%;
  max-width: 100%;
`

const MarkdownContainer = styled.div`
  & pre {
    background: transparent !important;
    span {
      white-space: pre-wrap;
    }
  }
`

const MessageTitleLabel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 10px;
  padding: 0;
  line-height: 20px;
`

const TitleContent = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const ToolName = styled(Flex)`
  color: var(--color-text);
  font-weight: 500;
  font-size: 13px;
  line-height: 20px;
  min-width: 0;
`

const ActionButtonsContainer = styled.div`
  display: flex;
  gap: 6px;
  margin-left: auto;
  align-items: center;
`

const ActionButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-2);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
  transition: all 0.2s;
  border-radius: 4px;
  gap: 4px;
  min-width: 28px;
  height: 28px;

  &:hover {
    opacity: 1;
    color: var(--color-text);
    background-color: var(--color-bg-3);
  }

  &.confirm-button {
    color: var(--color-primary);

    &:hover {
      background-color: var(--color-primary-bg);
      color: var(--color-primary);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
    opacity: 1;
  }

  .iconfont {
    font-size: 14px;
  }
`

const ToolResponseContainer = styled.div`
  border-radius: 0 0 4px 4px;
  overflow: auto;
  max-height: 300px;
  border-top: none;
  position: relative;
`

export default memo(MessageMcpTool)

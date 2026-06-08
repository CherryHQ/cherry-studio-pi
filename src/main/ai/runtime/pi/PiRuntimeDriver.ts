import fs from 'node:fs/promises'

import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import PiAgentService from '@main/ai/pi'
import { builtinTools } from '@main/ai/pi/builtin'
import mcpService from '@main/services/MCPService'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
import { parseDataUrl } from '@shared/utils'
import type { UIMessageChunk } from 'ai'

import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeUserInput,
  AgentSessionRuntimeDriver
} from '../types'

const logger = loggerService.withContext('PiRuntimeDriver')

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: item, done: false })
      return
    }
    this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as T, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true })
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
      }
    }
  }
}

class PiRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly piAgentService = new PiAgentService()
  private currentAbortController?: AbortController
  private closed = false

  readonly events = this.eventQueue

  constructor(private readonly input: AgentRuntimeConnectInput) {}

  send(input: AgentRuntimeUserInput): void {
    if (this.closed) return
    void this.runTurn(input.message).catch((error) => {
      this.eventQueue.push({ type: 'error', error })
    })
  }

  async interrupt(): Promise<void> {
    this.currentAbortController?.abort(new Error('agent-runtime-interrupted'))
  }

  close(): void {
    this.closed = true
    this.currentAbortController?.abort(new Error('agent-runtime-closed'))
    this.eventQueue.close()
  }

  private async runTurn(message: AgentSessionMessageEntity): Promise<void> {
    const abortController = new AbortController()
    this.currentAbortController = abortController

    const session = await this.buildPiRuntimeSession()
    const { prompt, images } = extractPromptInput(message)
    const stream = await this.piAgentService.invoke(
      prompt,
      session as never,
      abortController,
      this.input.resumeToken,
      undefined,
      images
    )

    if (stream.sdkSessionId) {
      this.eventQueue.push({ type: 'resume-token', token: stream.sdkSessionId })
    }

    await new Promise<void>((resolve) => {
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        if (this.currentAbortController === abortController) this.currentAbortController = undefined
        resolve()
      }

      stream.on('data', (event) => {
        if (this.closed || settled) return
        switch (event.type) {
          case 'chunk':
            if (event.chunk) {
              this.eventQueue.push({ type: 'chunk', chunk: event.chunk as UIMessageChunk })
            }
            break
          case 'complete':
            this.eventQueue.push({ type: 'turn-complete' })
            settle()
            break
          case 'cancelled':
            this.eventQueue.push({ type: 'error', error: new Error('Pi agent turn cancelled') })
            settle()
            break
          case 'error':
            this.eventQueue.push({ type: 'error', error: event.error ?? new Error('Pi agent turn failed') })
            settle()
            break
        }
      })
    })
  }

  private async buildPiRuntimeSession() {
    const [agent, session] = await Promise.all([
      agentService.getAgent(this.input.agentId),
      agentSessionService.getById(this.input.sessionId)
    ])
    if (!agent) throw new Error(`Agent not found: ${this.input.agentId}`)

    return {
      ...agent,
      id: session.id,
      agentId: agent.id,
      name: agent.name,
      model: this.input.modelId ?? agent.model,
      workspace: session.workspace,
      workspaceId: session.workspaceId,
      accessible_paths: session.workspace?.path ? [session.workspace.path] : undefined,
      accessiblePaths: session.workspace?.path ? [session.workspace.path] : undefined
    }
  }
}

function extractPromptInput(message: AgentSessionMessageEntity): {
  prompt: string
  images?: Array<{ data: string; media_type: string }>
} {
  const parts = Array.isArray(message.data?.parts) ? message.data.parts : []
  const text = parts
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim()

  const images = parts.flatMap((part) => {
    if (!part || typeof part !== 'object' || part.type !== 'file') return []
    const mediaType = typeof part.mediaType === 'string' ? part.mediaType : undefined
    const url = typeof part.url === 'string' ? part.url : undefined
    if (!mediaType?.startsWith('image/') || !url) return []
    const parsed = parseDataUrl(url)
    if (!parsed?.isBase64 || !parsed.mediaType?.startsWith('image/')) return []
    return [{ data: parsed.data, media_type: parsed.mediaType }]
  })

  return {
    prompt: text || '(empty message)',
    images: images.length > 0 ? images : undefined
  }
}

export class PiRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new Error(`Agent session ${session.id} has no workspace configured`)
    }
    await fs.mkdir(cwd, { recursive: true })
  }

  async listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    const builtins: Tool[] = builtinTools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      origin: 'builtin',
      approval: tool.requirePermissions ? 'prompt' : 'auto'
    }))

    const mcpTools = await mcpService.listActiveServerToolsByIds(mcpIds).catch((error) => {
      logger.warn('Failed to list Pi runtime MCP tools', { error })
      return []
    })

    return [
      ...builtins,
      ...mcpTools.map(
        (tool): Tool => ({
          id: tool.id,
          name: tool.name,
          description: tool.description,
          origin: 'mcp',
          approval: 'prompt',
          sourceId: tool.serverId,
          sourceName: tool.serverName
        })
      )
    ]
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return new PiRuntimeConnection(input)
  }
}

import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core'
import type {
  Api,
  ImageContent,
  Message as PiMessage,
  Model as PiModel,
  SimpleStreamOptions,
  UserMessage
} from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai'
import { loggerService } from '@logger'
import { validateModelId } from '@main/ai/modelValidation'
import { providerToAiSdkConfig } from '@main/ai/provider/config'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { getAgentSessionHistoryWithStorageV2Recovery } from '@main/services/agents/AgentStorageV2ReadThrough'
import type {
  AgentServiceInterface,
  AgentStream,
  AgentStreamEvent,
  AgentThinkingOptions
} from '@main/services/agents/interfaces/AgentStreamInterface'
import { getProxyEnvironment } from '@main/services/proxy/nodeProxy'
import {
  buildCherryStudioPiAgentInstructions,
  CHERRY_STUDIO_PI_AGENT_FALLBACK_NAME,
  isDefaultCherryStudioPiAgentInstructions,
  normalizeAgentInstructions
} from '@shared/ai/pi/constants'
import type { AgentPersistedMessage, MessageBlock } from '@shared/data/types/agent'
import { ENDPOINT_TYPE, type EndpointType, MODALITY, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { createPiMcpTools, createPiTools } from './tools'
import { PiStreamState } from './transform'

const logger = loggerService.withContext('PiAgentService')

const NO_KEY_PLACEHOLDERS: Record<string, string> = {
  ollama: 'ollama',
  lmstudio: 'lmstudio'
}

const PROVIDER_API_MAP = {
  anthropic: 'anthropic-messages',
  'azure-anthropic': 'anthropic-messages',
  'google-vertex-anthropic': 'anthropic-messages',
  google: 'google-generative-ai',
  'google-vertex': 'google-vertex',
  mistral: 'mistral-conversations',
  bedrock: 'bedrock-converse-stream',
  'azure-responses': 'azure-openai-responses',
  'azure-openai-responses': 'azure-openai-responses',
  openai: 'openai-completions',
  'openai-compatible': 'openai-completions',
  deepseek: 'openai-completions'
} satisfies Partial<Record<string, Api>>

const ENDPOINT_API_MAP = {
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'anthropic-messages',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: 'google-generative-ai',
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'openai-completions',
  [ENDPOINT_TYPE.OLLAMA_CHAT]: 'openai-completions',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'openai-responses'
} satisfies Partial<Record<EndpointType, Api>>

const MAX_HYDRATED_HISTORY_MESSAGES = 80

class PiAgentStream extends EventEmitter implements AgentStream {
  declare emit: (event: 'data', data: AgentStreamEvent) => boolean
  private readonly pendingEvents: AgentStreamEvent[] = []
  sdkSessionId?: string

  emitData(data: AgentStreamEvent): void {
    if (this.listenerCount('data') === 0) {
      this.pendingEvents.push(data)
      return
    }
    this.emit('data', data)
  }

  on(event: 'data', listener: (data: AgentStreamEvent) => void): this {
    super.on(event, listener)
    this.flushPendingEvents()
    return this
  }

  once(event: 'data', listener: (data: AgentStreamEvent) => void): this {
    super.once(event, listener)
    this.flushPendingEvents()
    return this
  }

  private flushPendingEvents(): void {
    if (this.pendingEvents.length === 0 || this.listenerCount('data') === 0) return
    const events = this.pendingEvents.splice(0)
    for (const event of events) this.emit('data', event)
  }
}

type CachedAgent = {
  key: string
  agent: Agent
}

type PiRuntimeSession = Parameters<AgentServiceInterface['invoke']>[1] & {
  accessible_paths?: string[]
  accessiblePaths?: string[]
  allowed_tools?: string[]
  allowedTools?: string[]
  modelId?: string | null
  workspace?: { path?: string | null } | null
}

class PiAgentService implements AgentServiceInterface {
  private readonly agents = new Map<string, CachedAgent>()

  async invoke(
    prompt: string,
    session: Parameters<AgentServiceInterface['invoke']>[1],
    abortController: AbortController,
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions,
    images?: Array<{ data: string; media_type: string }>
  ): Promise<AgentStream> {
    const stream = new PiAgentStream()
    stream.sdkSessionId = `pi:${session.id}`

    const paths = this.getAccessiblePaths(session)
    const cwd = paths[0]
    if (!cwd) {
      stream.emitData({ type: 'error', error: new Error('No accessible paths defined for the agent session') })
      return stream
    }

    const sessionModel = this.getSessionModel(session)
    if (!sessionModel) {
      stream.emitData({ type: 'error', error: new Error('No model defined for the agent session') })
      return stream
    }

    const mcps = this.getSessionMcps(session)
    const allowedTools = this.getAllowedTools(session)
    const modelInfo = await validateModelId(sessionModel)
    if (!modelInfo.valid || !modelInfo.provider || !modelInfo.model || !modelInfo.modelId) {
      stream.emitData({
        type: 'error',
        error: new Error(`Invalid model ID '${sessionModel}': ${JSON.stringify(modelInfo.error)}`)
      })
      return stream
    }

    const providerConfig = await providerToAiSdkConfig(modelInfo.provider, modelInfo.model)
    const apiKey = this.resolveApiKey(modelInfo.provider, providerConfig.providerSettings as Record<string, unknown>)
    const piModel = this.toPiModel(modelInfo.provider, modelInfo.model, modelInfo.modelId, providerConfig)
    const sessionKey = this.buildSessionKey({
      api: piModel.api,
      apiKeyHash: this.hashSecret(apiKey),
      baseUrl: piModel.baseUrl,
      cwd,
      instructions: this.getSessionInstructions(session),
      name: this.getAgentDisplayName(session.name),
      model: sessionModel,
      permissionMode: session.configuration?.permission_mode,
      paths,
      mcps,
      thinking: this.mapThinkingLevel(thinkingOptions),
      tools: allowedTools
    })

    const cached = this.agents.get(session.id)
    const agent =
      cached?.key === sessionKey
        ? cached.agent
        : await this.createAgent({
            cwd,
            lastAgentSessionId,
            sessionId: session.id,
            sessionKey,
            session,
            paths,
            mcps,
            allowedTools,
            model: piModel,
            apiKey,
            thinkingOptions
          })

    this.agents.set(session.id, { key: sessionKey, agent })

    const state = new PiStreamState(session.id, { emitReasoning: this.shouldEmitReasoning(thinkingOptions) })
    let completed = false
    const unsubscribe = agent.subscribe((event) => {
      for (const chunk of state.transform(event)) {
        stream.emitData({ type: 'chunk', chunk })
      }
      if (event.type === 'agent_end') {
        completed = true
        stream.emitData({ type: 'complete' })
      }
    })

    abortController.signal.addEventListener(
      'abort',
      () => {
        agent.abort()
        stream.emitData({ type: 'cancelled' })
      },
      { once: true }
    )

    setImmediate(() => {
      agent
        .prompt(prompt, this.toPiImages(images))
        .catch((error) => {
          logger.error('Pi agent stream failed', error as Error)
          stream.emitData({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) })
        })
        .finally(() => {
          if (!completed) {
            completed = true
            stream.emitData({ type: 'complete' })
          }
          unsubscribe()
        })
    })

    return stream
  }

  private async createAgent({
    cwd,
    lastAgentSessionId,
    sessionId,
    sessionKey,
    session,
    paths,
    mcps,
    allowedTools,
    model,
    apiKey,
    thinkingOptions
  }: {
    cwd: string
    lastAgentSessionId?: string
    sessionId: string
    sessionKey: string
    session: Parameters<AgentServiceInterface['invoke']>[1]
    paths: string[]
    mcps: string[]
    allowedTools: string[]
    model: PiModel<Api>
    apiKey: string
    thinkingOptions?: AgentThinkingOptions
  }) {
    logger.info('Creating Pi agent runtime', {
      sessionId,
      sessionKey,
      cwd,
      model: model.id,
      provider: model.provider,
      resumed: Boolean(lastAgentSessionId)
    })

    const tools = [...createPiTools(cwd, paths, { sessionId }), ...(await createPiMcpTools(mcps))]
    const allowedToolSet = new Set(allowedTools)
    const configuredTools =
      allowedToolSet.size > 0
        ? tools.filter((tool) => allowedToolSet.has(tool.name) || allowedToolSet.has(tool.label))
        : tools
    const systemPrompt = this.buildSystemPrompt(session, configuredTools)
    const history = await this.loadHistory(session.id)

    return new Agent({
      initialState: {
        systemPrompt,
        messages: history,
        model,
        tools: configuredTools,
        thinkingLevel: this.mapThinkingLevel(thinkingOptions)
      },
      streamFn: async (activeModel, context, options) => {
        return streamSimple(activeModel, context, {
          ...options,
          apiKey,
          headers: this.mergeHeaders(activeModel, options)
        })
      },
      beforeToolCall: async () => undefined,
      afterToolCall: async ({ result, isError }) => {
        if (isError) return undefined
        if (result.details && typeof result.details === 'object' && 'isError' in result.details) {
          return { isError: (result.details as Record<string, unknown>).isError === true }
        }
        return undefined
      },
      toolExecution: 'sequential'
    })
  }

  private buildSystemPrompt(session: Parameters<AgentServiceInterface['invoke']>[1], tools: AgentTool<any>[]): string {
    const agentName = this.getAgentDisplayName(session.name)
    const identityPrompt = this.buildIdentityPrompt(agentName)
    const sessionInstructions = this.getSessionInstructions(session).trim()
    const hasDefaultIdentityInstructions = isDefaultCherryStudioPiAgentInstructions(sessionInstructions, agentName)
    const hasExtendedIdentityInstructions =
      normalizeAgentInstructions(sessionInstructions).startsWith(normalizeAgentInstructions(identityPrompt)) &&
      !hasDefaultIdentityInstructions

    return [
      hasExtendedIdentityInstructions ? sessionInstructions : identityPrompt,
      this.buildPiToolGuidance(tools),
      sessionInstructions && !hasDefaultIdentityInstructions && !hasExtendedIdentityInstructions
        ? sessionInstructions
        : undefined
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  private buildIdentityPrompt(agentName: string): string {
    return buildCherryStudioPiAgentInstructions(agentName)
  }

  private getAgentDisplayName(name?: string | null): string {
    const normalized = (name ?? '').replace(/\s+/g, ' ').trim()
    return normalized || CHERRY_STUDIO_PI_AGENT_FALLBACK_NAME
  }

  private getAccessiblePaths(session: PiRuntimeSession): string[] {
    const paths = session.accessible_paths ?? session.accessiblePaths
    if (Array.isArray(paths) && paths.length > 0) return paths.filter(Boolean)
    const workspacePath = session.workspace?.path
    return workspacePath ? [workspacePath] : []
  }

  private getAllowedTools(session: PiRuntimeSession): string[] {
    const tools = session.allowed_tools ?? session.allowedTools
    return Array.isArray(tools) ? tools.filter(Boolean) : []
  }

  private getSessionMcps(session: PiRuntimeSession): string[] {
    return Array.isArray(session.mcps) ? session.mcps.filter(Boolean) : []
  }

  private getSessionModel(session: PiRuntimeSession): string {
    return (session.model ?? session.modelId ?? '').trim()
  }

  private getSessionInstructions(session: PiRuntimeSession): string {
    return (session.instructions ?? '').trim()
  }

  private buildPiToolGuidance(tools: AgentTool<any>[]): string {
    const mcpTools = tools.filter((tool) => tool.name.startsWith('mcp__'))
    const mcpSummary = mcpTools.length
      ? [
          'MCP tools are available and should be used when they are the best fit. Call only MCP tools listed in the actual tool schema.',
          'Available MCP tools:',
          ...mcpTools
            .slice(0, 40)
            .map((tool) => `- ${tool.name}: ${tool.description ? tool.description.slice(0, 160) : tool.label}`)
        ].join('\n')
      : 'No MCP tools are currently injected for this session. Use the built-in HTTPRequest and Browser* tools for web/API access when needed.'

    return `## Tool Use

Available built-in tools are Bash, Read, Write, Edit, Glob, Grep, HTTPRequest, AppSearchCapabilities, AppCallCapability, BrowserOpen, BrowserExecute, and BrowserReset.

${mcpSummary}

Use the least expensive tool first:
- Use Glob/Grep to locate files or symbols before broad Read calls.
- Use AppSearchCapabilities and AppCallCapability for Cherry Studio Pi app operations such as settings, data sync, backups, knowledge bases, notes, paintings, agents, storage, and navigation. These call internal app services directly and are preferred over HTTPRequest for in-app work.
- Use HTTPRequest for direct HTTP APIs, downloads, and raw web requests. Use BrowserOpen and BrowserExecute for rendered pages, JavaScript-heavy sites, login flows, or page interaction.
- For skill discovery, start with Glob pattern ".claude/skills/*/SKILL.md" from the workspace root. Do not probe guessed skill paths with failing Bash commands.
- Use Read with offset/limit for large files.
- Use Edit only after confirming the exact target text; if an edit is ambiguous, read more context and retry once.
- Batch related shell checks into one Bash command when safe, but make diagnostic checks tolerate misses (for example append "|| true") and avoid speculative commands.
- For dependency installs, inspect the package manager files first, then run the one matching install command. CLI packages may be installed with npm install -g; Cherry Studio Pi maps global npm installs to an agent-scoped tool prefix on PATH, so do not convert a CLI install into a project dependency. Prefer npm metadata/install for npm-distributed CLIs; use Homebrew when the user asks for Homebrew or it is the appropriate system-level installer.
- Read/Write/Edit/Bash can operate outside the workspace when the task requires it. Prefer the workspace for project edits, but use system and global paths when the user asks for system, network, certificate, package-manager, or app-level changes.
- System/global SSL, certificate, keychain, trust-store, npm/git/Node TLS, and network configuration commands are allowed when they are directly relevant to the user's request. These commands may affect the user's machine, so be precise and explain the intent before running them unless the session is already in full-auto mode.
- Keep tool outputs small: prefer commands like rg, git status --short, and targeted test commands over full-directory dumps.`
  }

  private async loadHistory(sessionId: string): Promise<AgentMessage[]> {
    try {
      const persisted = await getAgentSessionHistoryWithStorageV2Recovery(sessionId)
      return persisted
        .slice(-MAX_HYDRATED_HISTORY_MESSAGES)
        .map((message) => this.toPiHistoryMessage(message))
        .filter((message): message is PiMessage => Boolean(message))
    } catch (error) {
      logger.warn('Failed to hydrate Pi agent history; continuing with an empty transcript', error as Error)
      return []
    }
  }

  private toPiHistoryMessage(message: AgentPersistedMessage): PiMessage | undefined {
    const role = message.message?.role
    const timestamp = message.message?.createdAt ? new Date(message.message.createdAt).getTime() : Date.now()

    if (role === 'user') {
      const content = this.blocksToUserContent(message.blocks)
      if (!content) return undefined
      return {
        role: 'user',
        content,
        timestamp
      }
    }

    if (role === 'assistant') {
      const text = this.blocksToText(message.blocks, ['main_text', 'compact'])
      if (!text) return undefined
      return {
        role: 'assistant',
        content: [{ type: 'text', text }],
        api: 'openai-completions',
        provider: 'cherry-history',
        model: 'history',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'stop',
        timestamp
      }
    }

    return undefined
  }

  private blocksToUserContent(blocks: MessageBlock[]): UserMessage['content'] {
    const content: Array<{ type: 'text'; text: string } | ImageContent> = []
    const text = this.blocksToText(blocks, ['main_text', 'compact'])
    if (text) {
      content.push({ type: 'text', text })
    }

    for (const block of blocks) {
      if (block.type !== 'image' || !('url' in block) || typeof block.url !== 'string') continue
      const match = block.url.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) continue
      content.push({ type: 'image', mimeType: match[1], data: match[2] })
    }

    if (content.length === 0) return ''
    if (content.length === 1 && content[0].type === 'text') return content[0].text
    return content
  }

  private blocksToText(blocks: MessageBlock[], blockTypes: string[]): string {
    return blocks
      .filter((block) => blockTypes.includes(block.type) && 'content' in block && typeof block.content === 'string')
      .map((block) => ('content' in block && typeof block.content === 'string' ? block.content : ''))
      .filter(Boolean)
      .join('\n\n')
      .trim()
  }

  private toPiImages(images?: Array<{ data: string; media_type: string }>): ImageContent[] | undefined {
    if (!images?.length) return undefined
    return images.map((image) => ({
      type: 'image',
      data: image.data,
      mimeType: image.media_type
    }))
  }

  private resolveApiKey(provider: Provider, providerSettings: Record<string, unknown>): string {
    const apiKey = typeof providerSettings.apiKey === 'string' ? providerSettings.apiKey.trim() : ''
    return (
      apiKey ||
      NO_KEY_PLACEHOLDERS[provider.id] ||
      NO_KEY_PLACEHOLDERS[provider.presetProviderId ?? ''] ||
      'no-key-required'
    )
  }

  private toPiModel(
    provider: Provider,
    model: Model,
    modelId: string,
    providerConfig: Awaited<ReturnType<typeof providerToAiSdkConfig>>
  ): PiModel<Api> {
    const providerSettings = providerConfig.providerSettings as Record<string, unknown>
    const { endpointType } = resolveEffectiveEndpoint(provider, model)
    const api = this.determineApi(endpointType, providerConfig.providerId)
    const pricing = model.pricing

    return {
      id: modelId,
      name: model.name || modelId,
      api,
      provider: `cherry-${provider.id}`,
      baseUrl: typeof providerSettings.baseURL === 'string' ? providerSettings.baseURL : '',
      reasoning: this.hasCapability(model, MODEL_CAPABILITY.REASONING),
      input: this.supportsImageInput(model) ? ['text', 'image'] : ['text'],
      cost: {
        input: pricing?.input?.perMillionTokens ?? 0,
        output: pricing?.output?.perMillionTokens ?? 0,
        cacheRead: pricing?.cacheRead?.perMillionTokens ?? 0,
        cacheWrite: pricing?.cacheWrite?.perMillionTokens ?? 0
      },
      contextWindow: model.contextWindow ?? 128_000,
      maxTokens: model.maxOutputTokens ?? 16_384,
      headers: this.getProviderHeaders(providerSettings)
    }
  }

  private determineApi(endpointType: EndpointType | undefined, providerId: string): Api {
    const endpointApi = endpointType ? ENDPOINT_API_MAP[endpointType] : undefined
    if (endpointApi) return endpointApi

    const providerApi = PROVIDER_API_MAP[providerId]
    if (providerApi) return providerApi

    return 'openai-completions'
  }

  private supportsImageInput(model: Model): boolean {
    return (
      model.inputModalities?.includes(MODALITY.IMAGE) === true ||
      this.hasCapability(model, MODEL_CAPABILITY.IMAGE_RECOGNITION)
    )
  }

  private hasCapability(model: Model, capability: (typeof MODEL_CAPABILITY)[keyof typeof MODEL_CAPABILITY]): boolean {
    return model.capabilities.includes(capability)
  }

  private getProviderHeaders(providerSettings: Record<string, unknown>): Record<string, string> | undefined {
    const headers = providerSettings.headers
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined
    return Object.fromEntries(
      Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  }

  private mapThinkingLevel(thinkingOptions?: AgentThinkingOptions) {
    const effort = thinkingOptions?.effort
    if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh') {
      return effort
    }
    return this.shouldEmitReasoning(thinkingOptions) ? 'medium' : 'off'
  }

  private shouldEmitReasoning(thinkingOptions?: AgentThinkingOptions): boolean {
    const thinking = thinkingOptions?.thinking
    return thinking?.type === 'enabled' || thinking?.type === 'adaptive'
  }

  private mergeHeaders(model: PiModel<Api>, options?: SimpleStreamOptions): Record<string, string> | undefined {
    const proxyEnv = getProxyEnvironment(process.env)
    const headers = { ...model.headers, ...options?.headers }
    if (Object.keys(proxyEnv).length > 0) {
      Object.assign(process.env, proxyEnv)
    }
    return Object.keys(headers).length > 0 ? headers : undefined
  }

  private buildSessionKey(value: Record<string, unknown>): string {
    return JSON.stringify(value)
  }

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex')
  }
}

export default PiAgentService

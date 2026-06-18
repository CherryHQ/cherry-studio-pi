import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import { summarizeObjectShapeForLog, summarizeTextForLog, summarizeUrlForLog } from '@main/utils/logging'
import { type CreateMcpServerDto, CreateMcpServerSchema } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { IpcChannel } from '@shared/IpcChannel'

const logger = loggerService.withContext('ProtocolService:mcpInstall')
const MCP_SERVER_FALLBACK_NAME = 'MCP Server'

const MCP_SERVER_IMPORT_FIELDS = [
  'name',
  'type',
  'description',
  'baseUrl',
  'command',
  'registryUrl',
  'args',
  'env',
  'headers',
  'provider',
  'providerUrl',
  'logoUrl',
  'tags',
  'longRunning',
  'timeout',
  'dxtVersion',
  'dxtPath',
  'reference',
  'searchKey',
  'configSample',
  'disabledTools',
  'disabledAutoApproveTools',
  'shouldConfig',
  'sortOrder'
] as const

function decodeQueryComponentPreservingPlus(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getProtocolQueryParam(search: string, name: string) {
  const query = search.startsWith('?') ? search.slice(1) : search
  if (!query) return null

  for (const pair of query.split('&')) {
    const separatorIndex = pair.indexOf('=')
    const rawName = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair
    if (decodeQueryComponentPreservingPlus(rawName) !== name) continue

    const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : ''
    return decodeQueryComponentPreservingPlus(rawValue)
  }

  return null
}

function normalizeBase64Payload(value: string) {
  return value.replaceAll('_', '+').replaceAll('-', '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function summarizeValidationIssues(error: { issues: Array<{ path: PropertyKey[]; code: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code
  }))
}

function summarizeInstallError(error: unknown) {
  if (!isRecord(error)) {
    return { type: typeof error }
  }

  return {
    type: error.constructor?.name ?? typeof error,
    code: firstNonEmptyString(error.code, error.name)
  }
}

function normalizeProtocolMcpServer(input: unknown, fallbackName?: string, installedAt = Date.now()) {
  if (!isRecord(input)) {
    logger.warn('Skipping invalid MCP protocol server entry: expected object')
    return null
  }

  const candidate: Record<string, unknown> = {}
  for (const field of MCP_SERVER_IMPORT_FIELDS) {
    if (input[field] !== undefined) {
      candidate[field] = input[field]
    }
  }

  candidate.name =
    firstNonEmptyString(candidate.name, fallbackName, input.command, input.baseUrl, input.url) ??
    MCP_SERVER_FALLBACK_NAME
  candidate.installSource = 'protocol'
  candidate.isTrusted = false
  candidate.isActive = false
  candidate.installedAt = installedAt

  const parsed = CreateMcpServerSchema.safeParse(candidate)
  if (!parsed.success) {
    logger.warn('Skipping invalid MCP protocol server entry', {
      name: firstNonEmptyString(candidate.name),
      issues: summarizeValidationIssues(parsed.error)
    })
    return null
  }

  return parsed.data
}

function collectProtocolMcpServers(jsonConfig: unknown): CreateMcpServerDto[] {
  const installedAt = Date.now()

  if (isRecord(jsonConfig) && isRecord(jsonConfig.mcpServers)) {
    return Object.entries(jsonConfig.mcpServers).flatMap(([name, server]) => {
      const normalized = normalizeProtocolMcpServer(server, name, installedAt)
      return normalized ? [normalized] : []
    })
  }

  if (Array.isArray(jsonConfig)) {
    return jsonConfig.flatMap((server) => {
      const normalized = normalizeProtocolMcpServer(server, undefined, installedAt)
      return normalized ? [normalized] : []
    })
  }

  const normalized = normalizeProtocolMcpServer(jsonConfig, undefined, installedAt)
  return normalized ? [normalized] : []
}

function notifyInstalledMcpServer(server: McpServer) {
  application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.Mcp_AddServer, server)
}

async function installMcpServer(server: CreateMcpServerDto): Promise<McpServer | null> {
  try {
    const created = await mcpServerService.create(server)
    notifyInstalledMcpServer(created)
    return created
  } catch (error) {
    logger.error('Failed to install MCP server from protocol', {
      name: server.name,
      error: summarizeInstallError(error)
    })
    return null
  }
}

export async function handleMcpProtocolUrl(url: URL) {
  switch (url.pathname) {
    case '/install': {
      // jsonConfig example:
      // {
      //   "mcpServers": {
      //     "everything": {
      //       "command": "npx",
      //       "args": [
      //         "-y",
      //         "@modelcontextprotocol/server-everything"
      //       ]
      //     }
      //   }
      // }
      // cherrystudio://mcp/install?servers={base64Encode(JSON.stringify(jsonConfig))}

      const data = getProtocolQueryParam(url.search, 'servers')

      if (data) {
        try {
          const stringify = Buffer.from(normalizeBase64Payload(data), 'base64').toString('utf8')
          logger.debug('install MCP servers from protocol', { payload: summarizeTextForLog(stringify) })
          const jsonConfig = JSON.parse(stringify)
          logger.debug('install MCP servers from protocol parsed config', {
            payload: summarizeObjectShapeForLog(jsonConfig)
          })

          const servers = collectProtocolMcpServers(jsonConfig)
          for (const server of servers) {
            await installMcpServer(server)
          }

          if (servers.length === 0) {
            logger.warn('MCP protocol install payload contained no valid servers')
          }
        } catch (error) {
          logger.error('Failed to parse MCP protocol install payload', error as Error)
        }
      }

      application.get('MainWindowService').showMainWindow()

      break
    }
    default:
      logger.error('Unknown MCP protocol URL', { url: summarizeUrlForLog(url.toString()) })
      break
  }
}

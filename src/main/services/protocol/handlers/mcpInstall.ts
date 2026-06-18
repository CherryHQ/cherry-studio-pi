import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import { summarizeObjectShapeForLog, summarizeTextForLog, summarizeUrlForLog } from '@main/utils/logging'
import { nanoid } from '@reduxjs/toolkit'
import type { McpServer } from '@shared/data/types/mcpServer'
import { IpcChannel } from '@shared/IpcChannel'

const logger = loggerService.withContext('ProtocolService:mcpInstall')

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

function installMcpServer(server: McpServer) {
  const now = Date.now()

  const payload: McpServer = {
    ...server,
    id: server.id ?? nanoid(),
    installSource: 'protocol',
    isTrusted: false,
    isActive: false,
    trustedAt: undefined,
    installedAt: server.installedAt ?? now
  }

  application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.Mcp_AddServer, payload)
}

function installMcpServers(servers: Record<string, McpServer>) {
  for (const name in servers) {
    const server = servers[name]
    if (!server.name) {
      server.name = name
    }
    installMcpServer(server)
  }
}

export function handleMcpProtocolUrl(url: URL) {
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
        const stringify = Buffer.from(normalizeBase64Payload(data), 'base64').toString('utf8')
        logger.debug('install MCP servers from protocol', { payload: summarizeTextForLog(stringify) })
        const jsonConfig = JSON.parse(stringify)
        logger.debug('install MCP servers from protocol parsed config', {
          payload: summarizeObjectShapeForLog(jsonConfig)
        })

        // support both {mcpServers: [servers]}, [servers] and {server}
        if (jsonConfig.mcpServers) {
          installMcpServers(jsonConfig.mcpServers)
        } else if (Array.isArray(jsonConfig)) {
          for (const server of jsonConfig) {
            installMcpServer(server)
          }
        } else {
          installMcpServer(jsonConfig)
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

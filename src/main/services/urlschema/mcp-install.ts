import { loggerService } from '@logger'
import { summarizeUrlForLog } from '@main/utils/logging'
import { nanoid } from '@reduxjs/toolkit'
import { IpcChannel } from '@shared/IpcChannel'
import type { MCPServer } from '@types'

import { windowService } from '../WindowService'

const logger = loggerService.withContext('URLSchema:handleMcpProtocolUrl')

function summarizeMCPServerForProtocolLog(server: MCPServer) {
  return {
    id: server.id,
    name: server.name,
    type: server.type,
    provider: server.provider,
    hasCommand: Boolean(server.command),
    argsCount: server.args?.length ?? 0,
    envKeys: Object.keys(server.env ?? {}),
    headerKeys: Object.keys(server.headers ?? {}),
    hasBaseUrl: Boolean(server.baseUrl)
  }
}

function summarizeMCPInstallPayloadForLog(jsonConfig: unknown) {
  if (Array.isArray(jsonConfig)) {
    return {
      shape: 'array',
      count: jsonConfig.length,
      servers: jsonConfig.map((server) => summarizeMCPServerForProtocolLog(server as MCPServer))
    }
  }

  if (!jsonConfig || typeof jsonConfig !== 'object') {
    return { shape: typeof jsonConfig }
  }

  const config = jsonConfig as { mcpServers?: Record<string, MCPServer> } & MCPServer
  if (config.mcpServers) {
    const servers = Object.entries(config.mcpServers)
    return {
      shape: 'mcpServers',
      count: servers.length,
      servers: servers.map(([name, server]) =>
        summarizeMCPServerForProtocolLog({ ...server, name: server.name ?? name })
      )
    }
  }

  return {
    shape: 'server',
    count: 1,
    servers: [summarizeMCPServerForProtocolLog(config)]
  }
}

function installMCPServer(server: MCPServer) {
  const mainWindow = windowService.getMainWindow()
  const now = Date.now()

  const payload: MCPServer = {
    ...server,
    id: server.id ?? nanoid(),
    installSource: 'protocol',
    isTrusted: false,
    isActive: false,
    trustedAt: undefined,
    installedAt: server.installedAt ?? now
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannel.Mcp_AddServer, payload)
  }
}

function installMCPServers(servers: Record<string, MCPServer>) {
  for (const name in servers) {
    const server = servers[name]
    if (!server.name) {
      server.name = name
    }
    installMCPServer(server)
  }
}

export function handleMcpProtocolUrl(url: URL) {
  const params = new URLSearchParams(url.search)
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
      // cherrystudiopi://mcp/install?servers={base64Encode(JSON.stringify(jsonConfig))}

      const data = params.get('servers')

      if (data) {
        const stringify = Buffer.from(data, 'base64').toString('utf8')
        const jsonConfig = JSON.parse(stringify)
        logger.debug('Install MCP servers from urlschema', summarizeMCPInstallPayloadForLog(jsonConfig))

        // support both {mcpServers: [servers]}, [servers] and {server}
        if (jsonConfig.mcpServers) {
          installMCPServers(jsonConfig.mcpServers)
        } else if (Array.isArray(jsonConfig)) {
          for (const server of jsonConfig) {
            installMCPServer(server)
          }
        } else {
          installMCPServer(jsonConfig)
        }
      }

      windowService.getMainWindow()?.show()

      break
    }
    default:
      logger.error('Unknown MCP protocol URL', { url: summarizeUrlForLog(url.toString()) })
      break
  }
}

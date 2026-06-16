export type McpCatalogKind = 'prompts' | 'resources'

export interface McpCatalogServerRef {
  id: string
  name?: string
}

export interface McpCatalogLogger {
  warn: (message: string, context?: Record<string, unknown>) => void
}

export async function listMcpCatalogItems<T>(
  servers: readonly McpCatalogServerRef[],
  listItems: (serverId: string) => Promise<readonly T[]>,
  options: {
    kind: McpCatalogKind
    logger?: McpCatalogLogger
  }
): Promise<T[]> {
  const batches = await Promise.allSettled(
    servers.map(async (server) => ({
      items: await listItems(server.id),
      server
    }))
  )

  const loadedItems: T[] = []

  batches.forEach((batch, index) => {
    if (batch.status === 'fulfilled') {
      loadedItems.push(...batch.value.items)
      return
    }

    const server = servers[index]
    options.logger?.warn(`Failed to load MCP ${options.kind}`, {
      error: batch.reason,
      serverId: server?.id,
      serverName: server?.name
    })
  })

  return loadedItems
}

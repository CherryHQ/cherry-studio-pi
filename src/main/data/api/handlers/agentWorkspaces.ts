import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentWorkspaceSchemas } from '@shared/data/api/schemas/agentWorkspaces'
import { CreateAgentWorkspaceSchema } from '@shared/data/api/schemas/agentWorkspaces'

export const agentWorkspaceHandlers: HandlersFor<AgentWorkspaceSchemas> = {
  '/agent-workspaces': {
    GET: async () => {
      return await agentWorkspaceService.list()
    },

    POST: async ({ body }) => {
      const parsed = CreateAgentWorkspaceSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentWorkspaceService.findOrCreateByPath(parsed.data.path, { name: parsed.data.name })
    }
  },

  '/agent-workspaces/:workspaceId': {
    GET: async ({ params }) => {
      return await agentWorkspaceService.getById(params.workspaceId)
    }
  },

  '/agent-workspaces/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await agentWorkspaceService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/agent-workspaces/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await agentWorkspaceService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}

import type { Request, Response } from 'express'

import { getAgentWithStorageV2Recovery } from '../../../../services/agents/AgentStorageV2ReadThrough'
import { loggerService } from '../../../../services/LoggerService'

const logger = loggerService.withContext('ApiServerMiddleware')

// Since Zod validators handle their own errors, this is now a pass-through
export const handleValidationErrors = (_req: Request, _res: Response, next: any): void => {
  next()
}

// Middleware to check if agent exists
export const checkAgentExists = async (req: Request, res: Response, next: any): Promise<void> => {
  try {
    const { agentId } = req.params
    const agent = await getAgentWithStorageV2Recovery(agentId)

    if (!agent) {
      res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
      return
    }

    next()
  } catch (error) {
    logger.error('Error checking agent existence', {
      error: error as Error,
      agentId: req.params.agentId
    })
    res.status(500).json({
      error: {
        message: 'Failed to validate agent',
        type: 'internal_error',
        code: 'agent_validation_failed'
      }
    })
  }
}

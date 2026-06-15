import { mkdir } from 'node:fs/promises'

import { loggerService } from '@logger'
import { getPathStatus, type PathStatus } from '@main/utils/file/pathStatus'
import { t } from '@main/utils/language'

const logger = loggerService.withContext('AgentSessionWorkspace')

export class AgentSessionWorkspaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSessionWorkspaceError'
  }
}

export function isAgentSessionWorkspaceError(error: unknown): error is AgentSessionWorkspaceError {
  return error instanceof AgentSessionWorkspaceError
}

export function missingAgentSessionWorkspaceError(sessionId: string): AgentSessionWorkspaceError {
  return new AgentSessionWorkspaceError(`Agent session ${sessionId} has no workspace configured`)
}

export async function assertAgentSessionWorkspaceDirectory(
  sessionId: string,
  cwd: string,
  options: { runtime: string }
): Promise<void> {
  const status = await getPathStatus(cwd)
  if (status.ok && status.kind === 'directory') return

  logger.warn(`Agent session ${sessionId} workspace invalid: ${cwd}`, { runtime: options.runtime })
  throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, status))
}

export async function ensureAgentSessionWorkspaceDirectory(
  sessionId: string,
  cwd: string,
  options: { runtime: string }
): Promise<void> {
  const status = await getPathStatus(cwd)
  if (status.ok && status.kind === 'directory') return

  if (!status.ok && status.reason === 'missing') {
    try {
      await mkdir(cwd, { recursive: true })
    } catch (error) {
      const failedStatus = await getPathStatus(cwd)
      logger.warn(`Agent session ${sessionId} workspace create failed: ${cwd}`, { runtime: options.runtime, error })
      throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, failedStatus))
    }
    const createdStatus = await getPathStatus(cwd)
    if (createdStatus.ok && createdStatus.kind === 'directory') return
    logger.warn(`Agent session ${sessionId} workspace invalid after create: ${cwd}`, { runtime: options.runtime })
    throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, createdStatus))
  }

  logger.warn(`Agent session ${sessionId} workspace invalid: ${cwd}`, { runtime: options.runtime })
  throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, status))
}

function workspacePathErrorMessage(path: string, status: PathStatus): string {
  if (status.ok) {
    return t('agent.session.workspace_status.not_directory', { path })
  }
  return status.reason === 'missing'
    ? t('agent.session.workspace_status.missing', { path })
    : t('agent.session.workspace_status.inaccessible', { path })
}

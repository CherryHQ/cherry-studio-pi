import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: vi.fn() }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: vi.fn() }
}))

vi.mock('@main/ai/pi', () => ({
  default: class MockPiAgentService {
    invoke = vi.fn()
  }
}))

vi.mock('@main/ai/pi/builtin', () => ({
  builtinTools: []
}))

vi.mock('@main/services/MCPService', () => ({
  default: { listActiveServerToolsByIds: vi.fn() }
}))

vi.mock('@main/utils/language', () => ({
  t: (key: string, vars?: Record<string, unknown>) => `${key}:${String(vars?.path ?? '')}`
}))

const { PiRuntimeDriver } = await import('../PiRuntimeDriver')
const { isAgentSessionWorkspaceError } = await import('../../agentSessionWorkspace')

const roots: string[] = []

function createSession(workspacePath: string | null): AgentSessionEntity {
  return {
    id: 'session-1',
    workspaceId: workspacePath ? 'workspace-1' : null,
    workspace: workspacePath ? { id: 'workspace-1', name: 'Workspace', path: workspacePath } : null
  } as AgentSessionEntity
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'pi-runtime-workspace-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PiRuntimeDriver validateSession', () => {
  it('classifies missing workspace bindings as agent session workspace errors', async () => {
    const driver = new PiRuntimeDriver()

    let thrown: unknown
    try {
      await driver.validateSession(createSession(null))
    } catch (error) {
      thrown = error
    }

    expect(isAgentSessionWorkspaceError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ message: 'Agent session session-1 has no workspace configured' })
  })

  it('creates a missing workspace directory before running Pi agent sessions', async () => {
    const driver = new PiRuntimeDriver()
    const root = await createTempRoot()
    const workspacePath = path.join(root, 'new-workspace')

    await driver.validateSession(createSession(workspacePath))

    expect((await stat(workspacePath)).isDirectory()).toBe(true)
  })

  it('classifies non-directory workspace paths as agent session workspace errors', async () => {
    const driver = new PiRuntimeDriver()
    const root = await createTempRoot()
    const filePath = path.join(root, 'workspace-file')
    await writeFile(filePath, 'not a directory')

    let thrown: unknown
    try {
      await driver.validateSession(createSession(filePath))
    } catch (error) {
      thrown = error
    }

    expect(isAgentSessionWorkspaceError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ message: expect.stringContaining(filePath) })
  })
})

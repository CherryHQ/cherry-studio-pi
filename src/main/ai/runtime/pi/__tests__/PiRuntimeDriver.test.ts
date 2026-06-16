import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AgentSessionEntity, AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
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
const { agentService } = await import('@data/services/AgentService')
const { agentSessionService } = await import('@data/services/AgentSessionService')

const roots: string[] = []
const originalStorageV2Root = process.env.CHERRY_STUDIO_STORAGE_V2_ROOT

function createSession(workspacePath: string | null): AgentSessionEntity {
  return {
    id: 'session-1',
    workspaceId: workspacePath ? 'workspace-1' : null,
    workspace: workspacePath ? { id: 'workspace-1', name: 'Workspace', path: workspacePath } : null
  } as AgentSessionEntity
}

function createMessage(): AgentSessionMessageEntity {
  const now = new Date().toISOString()
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'user',
    data: { parts: [{ type: 'text', text: 'hello' }] },
    status: 'success',
    searchableText: 'hello',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: now,
    updatedAt: now
  } as AgentSessionMessageEntity
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'pi-runtime-workspace-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  vi.mocked(agentService.getAgent).mockReset()
  vi.mocked(agentSessionService.getById).mockReset()
  if (originalStorageV2Root === undefined) {
    delete process.env.CHERRY_STUDIO_STORAGE_V2_ROOT
  } else {
    process.env.CHERRY_STUDIO_STORAGE_V2_ROOT = originalStorageV2Root
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PiRuntimeDriver validateSession', () => {
  it('creates an app-owned default workspace when no session workspace is configured', async () => {
    const driver = new PiRuntimeDriver()
    const root = await createTempRoot()
    process.env.CHERRY_STUDIO_STORAGE_V2_ROOT = root

    await driver.validateSession(createSession(null))

    expect((await stat(path.join(root, 'Agents', 'system-sessions', 'session-1'))).isDirectory()).toBe(true)
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

  it('clears the active abort controller when a turn fails before opening a Pi stream', async () => {
    const driver = new PiRuntimeDriver()
    const root = await createTempRoot()
    vi.mocked(agentService.getAgent).mockResolvedValueOnce(null)
    vi.mocked(agentSessionService.getById).mockResolvedValueOnce(createSession(root))

    const connection = await driver.connect({
      sessionId: 'session-1',
      agentId: 'missing-agent',
      modelId: 'openai::gpt-4.1' as never
    })

    const iterator = connection.events[Symbol.asyncIterator]()
    const nextEvent = iterator.next()
    void connection.send({ message: createMessage() })

    const event = await nextEvent
    expect(event.done).toBe(false)
    expect(event.value).toMatchObject({
      type: 'error',
      error: expect.objectContaining({ message: 'Agent not found: missing-agent' })
    })
    expect(
      (connection as unknown as { currentAbortController?: AbortController }).currentAbortController
    ).toBeUndefined()
  })
})

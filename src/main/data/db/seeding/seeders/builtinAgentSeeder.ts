import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { agentTable, type InsertAgentRow } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable, type InsertAgentWorkspaceRow } from '@data/db/schemas/agentWorkspace'
import { preferenceTable } from '@data/db/schemas/preference'
import { userModelTable } from '@data/db/schemas/userModel'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { and, count, eq, isNull } from 'drizzle-orm'
import { v5 as uuidv5 } from 'uuid'

import type { DbType, ISeeder } from '../../types'

const BUILTIN_AGENT_NAMESPACE = '77d23b69-f8ba-4f85-a7f6-0f3a0670f241'
const CHERRY_ASSISTANT_FOLDER = 'cherry-assistant'
const CHERRY_ASSISTANT_AGENT_ID = uuidv5('agent:cherry-assistant', BUILTIN_AGENT_NAMESPACE)
const CHERRY_ASSISTANT_WORKSPACE_ID = uuidv5('workspace:cherry-assistant', BUILTIN_AGENT_NAMESPACE)
const CHERRY_ASSISTANT_SESSION_ID = uuidv5('session:cherry-assistant', BUILTIN_AGENT_NAMESPACE)
const DEFAULT_SESSION_NAME = '新会话'

type LocalizedText = string | Record<string, string>

interface BuiltinAgentDefinition {
  name?: string
  description?: LocalizedText
  instructions?: LocalizedText
  mcps?: string[]
  allowed_tools?: string[]
  configuration?: Record<string, unknown>
}

export interface BuiltinAgentSeederOptions {
  builtinAgentsRoot?: string
  workspaceRoot?: string
}

function pickLocalizedText(value: LocalizedText | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value['zh-CN'] ?? value['en-US'] ?? Object.values(value)[0] ?? ''
}

function readAgentDefinition(filePath: string): BuiltinAgentDefinition | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BuiltinAgentDefinition
  } catch {
    return null
  }
}

export class BuiltinAgentSeeder implements ISeeder {
  readonly name = 'builtinAgent'
  readonly description = 'Insert Cherry Studio Pi built-in agent and starter session'
  readonly version = '2026.06.09.1'

  constructor(private readonly options: BuiltinAgentSeederOptions = {}) {}

  async run(db: DbType): Promise<void> {
    const root = this.options.builtinAgentsRoot ?? application.getPath('feature.agents.builtin')
    const definition = readAgentDefinition(path.join(root, CHERRY_ASSISTANT_FOLDER, 'agent.json'))
    if (!definition) return

    const [{ count: activeAgentCount }] = await db
      .select({ count: count() })
      .from(agentTable)
      .where(isNull(agentTable.deletedAt))

    if (activeAgentCount > 0) return

    const defaultModelId = await this.resolveDefaultModelId(db)
    const workspace = await this.ensureWorkspace(db, definition.name ?? '小梅子助理')
    const [agentOrderKey, sessionOrderKey] = generateOrderKeySequence(2)

    const agentRow: InsertAgentRow = {
      id: CHERRY_ASSISTANT_AGENT_ID,
      type: 'pi',
      name: definition.name ?? '小梅子助理',
      description: pickLocalizedText(definition.description),
      instructions: pickLocalizedText(definition.instructions) || 'You are a helpful assistant.',
      model: defaultModelId,
      mcps: definition.mcps ?? [],
      disabledTools: [],
      configuration: {
        ...definition.configuration,
        allowed_tools: definition.allowed_tools ?? [],
        permission_mode: 'bypassPermissions',
        max_turns: 100,
        env_vars: {},
        soul_enabled: true,
        builtin_role: 'assistant',
        builtin_template: CHERRY_ASSISTANT_FOLDER
      },
      orderKey: agentOrderKey
    }
    await db.insert(agentTable).values(agentRow)

    await db.insert(agentSessionTable).values({
      id: CHERRY_ASSISTANT_SESSION_ID,
      agentId: CHERRY_ASSISTANT_AGENT_ID,
      name: DEFAULT_SESSION_NAME,
      description: '',
      workspaceId: workspace.id,
      orderKey: sessionOrderKey
    })
  }

  private async resolveDefaultModelId(db: DbType): Promise<string | null> {
    const [preference] = await db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'chat.default_model_id')))
      .limit(1)

    const modelId = typeof preference?.value === 'string' ? preference.value : null
    if (!modelId) return null

    const [model] = await db
      .select({ id: userModelTable.id })
      .from(userModelTable)
      .where(eq(userModelTable.id, modelId))
    return model?.id ?? null
  }

  private async ensureWorkspace(db: DbType, agentName: string): Promise<{ id: string }> {
    const workspaceRoot = this.options.workspaceRoot ?? application.getPath('feature.agents.workspaces')
    const workspacePath = path.join(workspaceRoot, CHERRY_ASSISTANT_FOLDER)
    fs.mkdirSync(workspacePath, { recursive: true })

    const [existing] = await db
      .select({ id: agentWorkspaceTable.id })
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.path, workspacePath))
      .limit(1)

    if (existing) return existing

    const [workspaceOrderKey] = generateOrderKeySequence(1)
    const workspaceRow: InsertAgentWorkspaceRow = {
      id: CHERRY_ASSISTANT_WORKSPACE_ID,
      name: agentName,
      path: workspacePath,
      type: AGENT_WORKSPACE_TYPE.SYSTEM,
      orderKey: workspaceOrderKey
    }
    await db.insert(agentWorkspaceTable).values(workspaceRow)

    return { id: CHERRY_ASSISTANT_WORKSPACE_ID }
  }
}

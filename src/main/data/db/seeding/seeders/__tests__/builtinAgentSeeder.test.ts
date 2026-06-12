import fs from 'node:fs'
import path from 'node:path'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { preferenceTable } from '@data/db/schemas/preference'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { BuiltinAgentSeeder } from '@data/db/seeding/seeders/builtinAgentSeeder'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('BuiltinAgentSeeder', () => {
  const dbh = setupTestDatabase()
  let tempDir: string
  let builtinRoot: string
  let workspaceRoot: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-builtin-agent-test-'))
    builtinRoot = path.join(tempDir, 'builtin-agents')
    workspaceRoot = path.join(tempDir, 'workspaces')
    fs.mkdirSync(path.join(builtinRoot, 'cherry-assistant'), { recursive: true })
    fs.writeFileSync(
      path.join(builtinRoot, 'cherry-assistant', 'agent.json'),
      JSON.stringify({
        name: '小梅子助理',
        description: { 'zh-CN': '内置通用 Agent', 'en-US': 'Built-in agent' },
        instructions: { 'zh-CN': '你是小梅子助理。', 'en-US': 'You are Xiao Meizi.' },
        configuration: { avatar: '小梅', permission_mode: 'default' }
      })
    )
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('seeds the built-in Pi agent, starter session, and workspace on an empty database', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'deepseek',
      name: 'DeepSeek',
      apiKeys: [],
      orderKey: 'a0'
    })
    await dbh.db.insert(userModelTable).values({
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      name: 'deepseek-chat',
      orderKey: 'a0'
    })
    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: 'chat.default_model_id',
      value: 'deepseek::deepseek-chat'
    })

    await new BuiltinAgentSeeder({ builtinAgentsRoot: builtinRoot, workspaceRoot }).run(dbh.db)

    const [agent] = await dbh.db.select().from(agentTable)
    expect(agent).toMatchObject({
      name: '小梅子助理',
      type: 'pi',
      model: 'deepseek::deepseek-chat',
      description: '内置通用 Agent',
      instructions: '你是小梅子助理。'
    })
    expect(agent.configuration).toMatchObject({
      avatar: '小梅',
      permission_mode: 'bypassPermissions',
      soul_enabled: true,
      builtin_role: 'assistant'
    })

    const [workspace] = await dbh.db.select().from(agentWorkspaceTable)
    expect(workspace.path).toBe(path.join(workspaceRoot, 'cherry-assistant'))
    expect(fs.statSync(workspace.path).isDirectory()).toBe(true)

    const [session] = await dbh.db.select().from(agentSessionTable)
    expect(session).toMatchObject({
      agentId: agent.id,
      workspaceId: workspace.id,
      name: '新会话'
    })
  })

  it('does not create a duplicate built-in agent when the user already has agents', async () => {
    await dbh.db.insert(agentTable).values({
      id: 'user-agent',
      type: 'pi',
      name: 'User Agent',
      instructions: 'Existing user agent',
      orderKey: 'a0'
    })

    await new BuiltinAgentSeeder({ builtinAgentsRoot: builtinRoot, workspaceRoot }).run(dbh.db)

    const agents = await dbh.db.select().from(agentTable)
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe('user-agent')
  })
})

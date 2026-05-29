import { describe, expect, it } from 'vitest'

import { DEFAULT_AGENT_CONFIGURATION, parseAgentConfiguration } from '../agentConfiguration'

describe('agent configuration helpers', () => {
  it('falls back to safe defaults for malformed local data', () => {
    const config = parseAgentConfiguration({
      avatar: 123,
      permission_mode: 'danger',
      max_turns: '100',
      env_vars: {
        VALID: 'yes',
        INVALID: 1
      },
      soul_enabled: 'true',
      scheduler_enabled: 'false',
      scheduler_type: 'later',
      heartbeat_enabled: 'true',
      heartbeat_interval: '30'
    })

    expect(config).toMatchObject({
      permission_mode: DEFAULT_AGENT_CONFIGURATION.permission_mode,
      max_turns: DEFAULT_AGENT_CONFIGURATION.max_turns,
      env_vars: { VALID: 'yes' },
      soul_enabled: DEFAULT_AGENT_CONFIGURATION.soul_enabled,
      scheduler_enabled: DEFAULT_AGENT_CONFIGURATION.scheduler_enabled,
      scheduler_type: DEFAULT_AGENT_CONFIGURATION.scheduler_type,
      heartbeat_enabled: DEFAULT_AGENT_CONFIGURATION.heartbeat_enabled,
      heartbeat_interval: DEFAULT_AGENT_CONFIGURATION.heartbeat_interval
    })
    expect(config.avatar).toBeUndefined()
  })

  it('keeps valid agent configuration values', () => {
    const config = parseAgentConfiguration({
      avatar: 'Pi',
      slash_commands: ['deploy', 42],
      permission_mode: 'acceptEdits',
      max_turns: 12,
      env_vars: {
        API_KEY: 'secret'
      },
      soul_enabled: false,
      scheduler_enabled: true,
      scheduler_type: 'cron',
      scheduler_cron: '0 * * * *',
      heartbeat_enabled: false,
      heartbeat_interval: 45
    })

    expect(config).toMatchObject({
      avatar: 'Pi',
      slash_commands: ['deploy'],
      permission_mode: 'acceptEdits',
      max_turns: 12,
      env_vars: { API_KEY: 'secret' },
      soul_enabled: false,
      scheduler_enabled: true,
      scheduler_type: 'cron',
      scheduler_cron: '0 * * * *',
      heartbeat_enabled: false,
      heartbeat_interval: 45
    })
  })
})

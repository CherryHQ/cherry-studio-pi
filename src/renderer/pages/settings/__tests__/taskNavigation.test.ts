import { describe, expect, it } from 'vitest'

import { getAgentSessionNavigationTarget } from '../taskNavigation'

describe('getAgentSessionNavigationTarget', () => {
  it('opens the agent session route with the session seed', () => {
    expect(getAgentSessionNavigationTarget(' session-1 ')).toEqual({
      to: '/app/agents',
      search: { sessionId: 'session-1' }
    })
  })

  it('ignores empty session ids', () => {
    expect(getAgentSessionNavigationTarget('   ')).toBeNull()
  })
})

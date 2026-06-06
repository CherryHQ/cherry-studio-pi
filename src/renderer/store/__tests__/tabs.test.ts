import { describe, expect, it } from 'vitest'

import tabsReducer, { removeTab, setActiveTab, setTabs } from '../tabs'

describe('tabs store', () => {
  it('does not remove the last tab', () => {
    const state = tabsReducer(undefined, removeTab('home'))

    expect(state.tabs).toEqual([{ id: 'home', path: '/' }])
    expect(state.activeTabId).toBe('home')
  })

  it('removes home or agents when another tab remains', () => {
    const withAgent = tabsReducer(
      undefined,
      setTabs([
        { id: 'home', path: '/' },
        { id: 'agents', path: '/agents' }
      ])
    )
    const activeHome = tabsReducer(withAgent, setActiveTab('home'))
    const state = tabsReducer(activeHome, removeTab('home'))

    expect(state.tabs).toEqual([{ id: 'agents', path: '/agents' }])
    expect(state.activeTabId).toBe('agents')
  })
})

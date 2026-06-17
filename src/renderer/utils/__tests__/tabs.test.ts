import { describe, expect, it } from 'vitest'

import { canCloseVisibleTab, getTabBaseId, getTabIdFromPath } from '../tabs'

describe('tabs utils', () => {
  it('allows closing tabs only when more than one visible tab exists', () => {
    expect(canCloseVisibleTab(0)).toBe(false)
    expect(canCloseVisibleTab(1)).toBe(false)
    expect(canCloseVisibleTab(2)).toBe(true)
  })

  it('keeps the base id for home and agent tabs independent of closeability', () => {
    expect(getTabBaseId(getTabIdFromPath('/'))).toBe('home')
    expect(getTabBaseId(getTabIdFromPath('/agents'))).toBe('agents')
  })

  it('falls back to home when a persisted tab path is not a valid URL', () => {
    expect(getTabIdFromPath('http://[broken')).toBe('home')
  })
})

import { isValidElement, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  topView: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.topView
}))

describe('AgentSidePanelDrawer', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('shows the drawer through a stable TopView key', async () => {
    const { default: AgentSidePanelDrawer } = await import('../AgentSidePanelDrawer')

    const shown = AgentSidePanelDrawer.show()

    expect(mocks.topView.show).toHaveBeenCalledTimes(1)
    const [element, key] = mocks.topView.show.mock.calls[0]
    expect(key).toBe('AgentSidePanelDrawer')
    expect(isValidElement(element)).toBe(true)

    ;(element as ReactElement<{ resolve: () => void }>).props.resolve()
    await expect(shown).resolves.toBeUndefined()
  })

  it('hides the stable TopView key before the drawer component mounts', async () => {
    const { default: AgentSidePanelDrawer } = await import('../AgentSidePanelDrawer')

    AgentSidePanelDrawer.hide()

    expect(mocks.topView.hide).toHaveBeenCalledTimes(1)
    expect(mocks.topView.hide).toHaveBeenCalledWith('AgentSidePanelDrawer')
  })
})

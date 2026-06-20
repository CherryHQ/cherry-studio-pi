import { isValidElement, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeTransientResourceSelectors: vi.fn(),
  topView: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

vi.mock('@renderer/components/ResourceSelector/resourceSelectorEvents', () => ({
  closeTransientResourceSelectors: mocks.closeTransientResourceSelectors
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

    expect(mocks.closeTransientResourceSelectors).toHaveBeenCalledTimes(1)
    expect(mocks.topView.show).toHaveBeenCalledTimes(1)
    const [element, key] = mocks.topView.show.mock.calls[0]
    expect(key).toBe('AgentSidePanelDrawer')
    expect(isValidElement(element)).toBe(true)

    ;(element as ReactElement<{ resolve: () => void }>).props.resolve()
    await expect(shown).resolves.toBeUndefined()
  })

  it('keeps repeated show calls idempotent while the drawer is active', async () => {
    const { default: AgentSidePanelDrawer } = await import('../AgentSidePanelDrawer')

    const first = AgentSidePanelDrawer.show()
    const second = AgentSidePanelDrawer.show()

    expect(first).toBe(second)
    expect(mocks.topView.show).toHaveBeenCalledTimes(1)

    const [element] = mocks.topView.show.mock.calls[0]
    ;(element as ReactElement<{ resolve: () => void }>).props.resolve()

    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
  })

  it('hides the stable TopView key before the drawer component mounts', async () => {
    const { default: AgentSidePanelDrawer } = await import('../AgentSidePanelDrawer')

    AgentSidePanelDrawer.hide()

    expect(mocks.closeTransientResourceSelectors).toHaveBeenCalledTimes(1)
    expect(mocks.topView.hide).toHaveBeenCalledTimes(1)
    expect(mocks.topView.hide).toHaveBeenCalledWith('AgentSidePanelDrawer')
  })

  it('settles a pending show promise if hidden before the drawer mounts', async () => {
    const { default: AgentSidePanelDrawer } = await import('../AgentSidePanelDrawer')

    const shown = AgentSidePanelDrawer.show()
    mocks.closeTransientResourceSelectors.mockClear()
    AgentSidePanelDrawer.hide()

    expect(mocks.closeTransientResourceSelectors).toHaveBeenCalledTimes(1)
    await expect(shown).resolves.toBeUndefined()
    expect(mocks.topView.hide).toHaveBeenCalledWith('AgentSidePanelDrawer')
  })

  it('hard-closes the TopView directly instead of waiting for a mounted drawer animation', async () => {
    const { default: AgentSidePanelDrawer } = await import('../AgentSidePanelDrawer')

    AgentSidePanelDrawer.hide()

    expect(mocks.closeTransientResourceSelectors).toHaveBeenCalledTimes(1)
    expect(mocks.topView.hide).toHaveBeenCalledTimes(1)
    expect(mocks.topView.hide).toHaveBeenCalledWith('AgentSidePanelDrawer')
  })
})

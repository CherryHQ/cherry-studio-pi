import { act, cleanup, render, waitFor } from '@testing-library/react'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeTransientResourceSelectors: vi.fn(),
  forceCloseEvent: 'cherry:resource-selector:force-close',
  topView: {
    show: vi.fn(),
    hide: vi.fn()
  }
}))

vi.mock('@renderer/components/ResourceSelector/resourceSelectorEvents', () => ({
  closeTransientResourceSelectors: mocks.closeTransientResourceSelectors,
  RESOURCE_SELECTOR_FORCE_CLOSE_EVENT: mocks.forceCloseEvent
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: mocks.topView
}))

vi.mock('antd', () => ({
  Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div data-testid="agent-side-panel-drawer">{children}</div> : null
}))

vi.mock('../../AgentSidePanel', () => ({
  default: () => <div data-testid="agent-side-panel" />
}))

describe('AgentSidePanelDrawer', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.resetModules()
    vi.useRealTimers()
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

  it('closes the mounted drawer when transient resource surfaces are force-closed', async () => {
    const { default: AgentSidePanelDrawer } = await import('../AgentSidePanelDrawer')

    const shown = AgentSidePanelDrawer.show()
    const [element] = mocks.topView.show.mock.calls[0]
    render(element as ReactElement)

    await act(async () => {})

    act(() => {
      window.dispatchEvent(new CustomEvent(mocks.forceCloseEvent))
    })

    await waitFor(() => expect(mocks.topView.hide).toHaveBeenCalledWith('AgentSidePanelDrawer'))
    await expect(shown).resolves.toBeUndefined()
  })
})

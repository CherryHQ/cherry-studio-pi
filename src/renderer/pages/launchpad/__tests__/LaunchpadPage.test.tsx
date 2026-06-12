import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LaunchpadPage from '../LaunchpadPage'

const mocks = vi.hoisted(() => ({
  openTab: vi.fn()
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    pinned: [],
    openedKeepAliveMiniApps: []
  })
}))

vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({
    openTab: mocks.openTab
  })
}))

vi.mock('@renderer/components/MiniApp/MiniApp', () => ({
  default: () => <div data-testid="mini-app" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('LaunchpadPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the Agent app through the tab system instead of navigating inside the home tab', () => {
    render(<LaunchpadPage />)

    fireEvent.click(screen.getByText('agent.sidebar_title'))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/agents')
  })
})

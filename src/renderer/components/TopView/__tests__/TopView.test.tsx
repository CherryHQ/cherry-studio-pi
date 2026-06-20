import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/AppModal', () => ({
  default: () => null
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [{ enabled: false }]
}))

vi.mock('@renderer/hooks/useAppInit', () => ({
  useAppInit: vi.fn()
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  useTopicAutoRenameSync: vi.fn()
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useAgentSessionAutoRenameSync: vi.fn()
}))

vi.mock('../toast', () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => children,
  useToasts: () => ({})
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import TopViewContainer, { TopView } from '../index'

function renderTopView(children: ReactNode = null) {
  return render(<TopViewContainer>{children}</TopViewContainer>)
}

describe('TopView', () => {
  beforeEach(() => {
    TopView.clear()
  })

  it('replaces an existing view with the same id instead of leaving stale content mounted', () => {
    renderTopView()

    act(() => {
      TopView.show(<div>First view</div>, 'shared-popup')
    })
    expect(screen.getByText('First view')).toBeInTheDocument()

    act(() => {
      TopView.show(<div>Second view</div>, 'shared-popup')
    })

    expect(screen.queryByText('First view')).not.toBeInTheDocument()
    expect(screen.getByText('Second view')).toBeInTheDocument()
  })

  it('pops the latest mounted view through the exported API', () => {
    renderTopView()

    act(() => {
      TopView.show(<div>Older view</div>, 'older-popup')
      TopView.show(<div>Latest view</div>, 'latest-popup')
    })

    act(() => {
      TopView.pop()
    })

    expect(screen.getByText('Older view')).toBeInTheDocument()
    expect(screen.queryByText('Latest view')).not.toBeInTheDocument()
  })

  it('does not bypass popup close handlers when the fullscreen backdrop is clicked', () => {
    const { container } = renderTopView()

    act(() => {
      TopView.show(<div>Promise popup</div>, 'promise-popup')
    })

    const backdrop = container.querySelector('.topview-backdrop')
    expect(backdrop).toBeInstanceOf(HTMLElement)

    fireEvent.click(backdrop as HTMLElement)

    expect(screen.getByText('Promise popup')).toBeInTheDocument()
  })

  it('does not let an older unmount clear a newer TopView registration', () => {
    const older = renderTopView()
    renderTopView()

    older.unmount()

    act(() => {
      TopView.show(<div>Current view</div>, 'current-popup')
    })

    expect(screen.getByText('Current view')).toBeInTheDocument()
  })
})

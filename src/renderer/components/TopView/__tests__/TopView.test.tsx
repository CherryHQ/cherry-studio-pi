import { act, render, screen } from '@testing-library/react'
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
})

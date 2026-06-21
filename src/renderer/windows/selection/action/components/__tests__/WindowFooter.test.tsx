import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WindowFooter from '../WindowFooter'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn()
}))

vi.mock('@ant-design/icons', () => ({
  LoadingOutlined: () => <span data-testid="loading-icon" />
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  RefreshIcon: () => <span data-testid="refresh-icon" />
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_name: string, callback: () => void) => callback()
  })
}))

vi.mock('lucide-react', () => ({
  CircleX: () => <span data-testid="close-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
  Pause: () => <span data-testid="pause-icon" />
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

function renderFooter(props?: Partial<React.ComponentProps<typeof WindowFooter>>) {
  return render(<WindowFooter content="copy text" {...props} />)
}

describe('WindowFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mocks.writeText
      }
    })
  })

  it('does not crash after a successful copy before toast is available', async () => {
    mocks.writeText.mockResolvedValue(undefined)
    renderFooter()

    fireEvent.click(screen.getByText('selection.action.window.c_copy'))

    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenCalledWith('copy text')
    })
  })

  it('does not crash after a failed copy before toast is available', async () => {
    mocks.writeText.mockRejectedValue(new Error('clipboard denied'))
    renderFooter()

    fireEvent.click(screen.getByText('selection.action.window.c_copy'))

    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenCalledWith('copy text')
    })
  })
})

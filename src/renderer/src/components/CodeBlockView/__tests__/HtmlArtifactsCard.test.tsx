import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HtmlArtifactsCard from '../HtmlArtifactsCard'

const mocks = vi.hoisted(() => ({
  createTempFile: vi.fn(),
  write: vi.fn(),
  openPath: vi.fn(),
  save: vi.fn(),
  openExternal: vi.fn(),
  toastError: vi.fn(),
  t: vi.fn((key: string, fallback?: string) => fallback ?? key)
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: mocks.t
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

vi.mock('../HtmlArtifactsPopup', () => ({
  default: () => <div data-testid="html-artifacts-popup" />
}))

describe('HtmlArtifactsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTempFile.mockResolvedValue('/tmp/artifacts-preview.html')
    mocks.write.mockResolvedValue(undefined)
    mocks.openPath.mockResolvedValue(undefined)
    mocks.save.mockResolvedValue(undefined)

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          createTempFile: mocks.createTempFile,
          write: mocks.write,
          openPath: mocks.openPath,
          save: mocks.save
        },
        shell: {
          openExternal: mocks.openExternal
        }
      }
    })

    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError,
        success: vi.fn()
      }
    })
  })

  it('opens generated HTML artifacts through the file API', async () => {
    const user = userEvent.setup()
    const html = '<html><head><title>Preview</title></head><body>Hello</body></html>'

    render(<HtmlArtifactsCard html={html} />)

    await user.click(screen.getByText('chat.artifacts.button.openExternal'))

    expect(mocks.createTempFile).toHaveBeenCalledWith('artifacts-preview.html')
    expect(mocks.write).toHaveBeenCalledWith('/tmp/artifacts-preview.html', html)
    expect(mocks.openPath).toHaveBeenCalledWith('/tmp/artifacts-preview.html')
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('shows an error toast when opening the generated artifact fails', async () => {
    const user = userEvent.setup()
    mocks.openPath.mockRejectedValueOnce(new Error('blocked'))

    render(<HtmlArtifactsCard html="<html><body>Hello</body></html>" />)

    await user.click(screen.getByText('chat.artifacts.button.openExternal'))

    expect(mocks.toastError).toHaveBeenCalledWith('chat.artifacts.preview.openExternal.error.content')
  })
})

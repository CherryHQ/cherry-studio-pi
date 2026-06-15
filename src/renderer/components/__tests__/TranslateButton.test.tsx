import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TranslateButton from '../TranslateButton'

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  loggerWarn: vi.fn(),
  modalConfirm: vi.fn(),
  toastError: vi.fn(),
  translateText: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'chat.input.translate.target_language') return ['en-us']
    if (key === 'chat.input.translate.show_confirm') return [false]
    return [undefined]
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: mocks.loggerWarn
    })
  }
}))

vi.mock('@renderer/hooks/translate/useTranslateLanguages', () => ({
  useLanguages: () => ({
    getLabel: () => 'English',
    languages: [{ langCode: 'en-us', label: 'English' }]
  })
}))

vi.mock('@renderer/services/TranslateService', () => ({
  translateText: mocks.translateText
}))

vi.mock('lucide-react', () => ({
  Languages: () => <span data-testid="languages-icon" />,
  Loader2: () => <span data-testid="loader-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('TranslateButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mocks.clipboardWriteText
      }
    })
    Object.defineProperty(window, 'modal', {
      configurable: true,
      value: {
        confirm: mocks.modalConfirm
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: mocks.toastError
      }
    })
  })

  it('continues translating when copying source text to clipboard fails', async () => {
    mocks.clipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'))
    mocks.translateText.mockResolvedValueOnce('translated text')
    const onTranslated = vi.fn()

    render(<TranslateButton text="source text" onTranslated={onTranslated} />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(onTranslated).toHaveBeenCalledWith('translated text')
    })
    expect(mocks.translateText).toHaveBeenCalledWith('source text', { langCode: 'en-us', label: 'English' })
    expect(mocks.loggerWarn).toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})

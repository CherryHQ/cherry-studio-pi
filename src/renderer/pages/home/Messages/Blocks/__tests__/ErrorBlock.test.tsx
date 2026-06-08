import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: { get: vi.fn(), patch: vi.fn() }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  }
}))

vi.mock('@renderer/components/ErrorDetailModal', () => ({
  showErrorDetailPopup: vi.fn()
}))

vi.mock('@renderer/data/CacheService', () => ({
  cacheService: { getCasual: vi.fn(), setCasual: vi.fn(), deleteCasual: vi.fn() }
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/i18n/label', () => ({
  getHttpMessageLabel: (status: string) => `HTTP ${status}`,
  getProviderLabel: (providerId: string) => `Provider ${providerId}`
}))

vi.mock('@renderer/services/ErrorDiagnosisService', () => ({
  classifyErrorByAI: vi.fn()
}))

vi.mock('@renderer/utils/errorClassifier', () => ({
  classifyError: vi.fn(() => ({ category: 'unknown', i18nKey: 'error.unknown' }))
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: any) => <span>{children}</span>,
  useNavigate: () => vi.fn()
}))

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  useTranslation: () => ({
    i18n: {
      exists: (key: string) => key === 'error.network.timeout'
    },
    t: (key: string) =>
      (
        ({
          'error.network.timeout': '网络请求超时'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

vi.mock('../V2Contexts', () => ({
  useRefresh: () => vi.fn()
}))

import { ErrorMessage } from '../ErrorBlock'

describe('ErrorMessage', () => {
  it('renders explicit i18nKey translations even when no provider placeholder is present', () => {
    render(<ErrorMessage error={{ message: 'raw timeout', i18nKey: 'network.timeout' } as any} />)

    expect(screen.getByText('网络请求超时')).toBeInTheDocument()
    expect(screen.queryByText('raw timeout')).not.toBeInTheDocument()
  })

  it('falls back to the raw message when no translation is available', () => {
    render(<ErrorMessage error={{ message: 'raw failure' } as any} />)

    expect(screen.getByText('raw failure')).toBeInTheDocument()
  })
})

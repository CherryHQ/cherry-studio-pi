import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorDetailContent } from '..'

const mocks = vi.hoisted(() => ({
  highlightCode: vi.fn()
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    highlightCode: mocks.highlightCode
  })
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/components/Popups/GeneralPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('../AiDiagnosisSection', () => ({
  default: () => null
}))

describe('ErrorDetailContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.highlightCode.mockImplementation(async (code: string) => `<pre><code>${code}</code></pre>`)
  })

  it('renders non-JSON AI SDK error causes as escaped text', async () => {
    const cause = '<img src="x" onerror="alert(1)"><script>alert(2)</script>'
    const { container } = render(
      <ErrorDetailContent
        error={{
          name: 'AI_TypeValidationError',
          message: 'Invalid response',
          stack: null,
          cause,
          value: {}
        }}
      />
    )

    await waitFor(() => expect(container.querySelector('.markdown')?.textContent).toContain(cause))
    expect(container.querySelector('.markdown script')).toBeNull()
    expect(container.querySelector('.markdown img')).toBeNull()
  })

  it('sanitizes highlighted JSON cause HTML before rendering', async () => {
    mocks.highlightCode.mockResolvedValueOnce('<pre><code>{"ok":true}</code></pre><script>alert(1)</script>')
    const { container } = render(
      <ErrorDetailContent
        error={{
          name: 'AI_TypeValidationError',
          message: 'Invalid response',
          stack: null,
          cause: '{"ok":true}',
          value: {}
        }}
      />
    )

    await waitFor(() => expect(container.querySelector('.markdown pre')).not.toBeNull())
    expect(container.querySelector('.markdown script')).toBeNull()
    expect(container.querySelector('.markdown')?.textContent).toContain('{"ok":true}')
  })
})

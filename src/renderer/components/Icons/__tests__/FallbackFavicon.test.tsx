import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FallbackFavicon from '../FallbackFavicon'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

describe('FallbackFavicon', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('waits for the first successful favicon source instead of resolving on a failed source', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target.startsWith('https://icon.horse/')) {
        return { ok: false, status: 404 }
      }

      if (target.startsWith('https://favicon.splitbee.io/')) {
        return { ok: true, status: 200 }
      }

      return { ok: false, status: 404 }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<FallbackFavicon hostname="example.com" alt="Example" />)

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Example' })).toHaveAttribute(
        'src',
        'https://favicon.splitbee.io/?url=example.com'
      )
    )
  })
})

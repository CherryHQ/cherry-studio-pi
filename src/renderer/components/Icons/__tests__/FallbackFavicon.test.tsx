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
    vi.useRealTimers()
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

  it('aborts outstanding favicon probes after a source resolves', async () => {
    const abortedUrls: string[] = []
    let capturedSignal: AbortSignal | undefined
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      const signal = init?.signal as AbortSignal | undefined
      capturedSignal = signal

      if (target.startsWith('https://icon.horse/')) {
        return Promise.resolve({ ok: true, status: 200 })
      }

      signal?.addEventListener('abort', () => abortedUrls.push(target), { once: true })
      return new Promise(() => undefined)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<FallbackFavicon hostname="example.com" alt="Example" />)

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Example' })).toHaveAttribute('src', 'https://icon.horse/icon/example.com')
    )
    await waitFor(() => expect(capturedSignal?.aborted).toBe(true))
    expect(abortedUrls).toEqual([
      'https://favicon.splitbee.io/?url=example.com',
      'https://favicon.im/example.com',
      'https://example.com/favicon.ico'
    ])
  })
})

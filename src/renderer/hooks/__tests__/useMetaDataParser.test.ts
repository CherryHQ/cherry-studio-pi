import { act, renderHook, waitFor } from '@testing-library/react'
import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMetaDataParser } from '../useMetaDataParser'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isCancel: vi.fn(() => false)
  }
}))

const properties = ['og:title'] as const

describe('useMetaDataParser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows parsing the same link again after a previous parse completes', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: '<meta property="og:title" content="First">' })
      .mockResolvedValueOnce({ data: '<meta property="og:title" content="Second">' })

    const { result } = renderHook(() => useMetaDataParser('https://example.com', properties))

    await act(async () => {
      await result.current.parseMetadata()
    })
    expect(result.current.metadata['og:title']).toBe('First')
    expect(result.current.isLoading).toBe(false)

    await act(async () => {
      await result.current.parseMetadata()
    })

    expect(axios.get).toHaveBeenCalledTimes(2)
    expect(result.current.metadata['og:title']).toBe('Second')
  })

  it('resets loading state when the link changes so lazy previews can fetch the new URL', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: '<meta property="og:title" content="First">' })
      .mockResolvedValueOnce({ data: '<meta property="og:title" content="Second">' })

    const { result, rerender } = renderHook(({ link }: { link: string }) => useMetaDataParser(link, properties), {
      initialProps: { link: 'https://first.example' }
    })

    await act(async () => {
      await result.current.parseMetadata()
    })
    expect(result.current.metadata['og:title']).toBe('First')
    expect(result.current.isLoading).toBe(false)

    rerender({ link: 'https://second.example' })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true)
    })

    await act(async () => {
      await result.current.parseMetadata()
    })

    expect(axios.get).toHaveBeenLastCalledWith('https://second.example', expect.objectContaining({ timeout: 5000 }))
    expect(result.current.metadata['og:title']).toBe('Second')
  })
})

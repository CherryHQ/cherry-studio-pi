import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelAnimationFrame: vi.fn(),
  measureElement: vi.fn(),
  requestAnimationFrame: vi.fn(() => 42),
  scrollToIndex: vi.fn()
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 200,
    getVirtualItems: () => [{ index: 0, key: 'item-1', start: 0 }],
    measureElement: mocks.measureElement,
    scrollToIndex: mocks.scrollToIndex
  })
}))

const { ChatVirtualList } = await import('../ChatVirtualList')

describe('ChatVirtualList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('requestAnimationFrame', mocks.requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', mocks.cancelAnimationFrame)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cancels the initial scroll frame on unmount', () => {
    const { unmount } = render(
      <ChatVirtualList
        items={['hello']}
        getItemKey={(item) => item}
        renderItem={(item) => <div>{item}</div>}
        estimateSize={200}
      />
    )

    expect(mocks.requestAnimationFrame).toHaveBeenCalledTimes(1)

    unmount()

    expect(mocks.cancelAnimationFrame).toHaveBeenCalledWith(42)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getResourceSelectorForceCloseSource,
  requestCloseResourceSelectors,
  RESOURCE_SELECTOR_FORCE_CLOSE_EVENT,
  scheduleCloseTransientResourceSelectors
} from '../resourceSelectorEvents'

const originalWindowDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()

function stubWindowProperty(key: PropertyKey, value: unknown) {
  if (!originalWindowDescriptors.has(key)) {
    originalWindowDescriptors.set(key, Object.getOwnPropertyDescriptor(window, key))
  }

  Object.defineProperty(window, key, {
    configurable: true,
    value
  })
}

afterEach(() => {
  for (const [key, descriptor] of originalWindowDescriptors) {
    if (descriptor) {
      Object.defineProperty(window, key, descriptor)
    } else {
      delete (window as unknown as Record<PropertyKey, unknown>)[key]
    }
  }
  originalWindowDescriptors.clear()
  vi.restoreAllMocks()
})

describe('resourceSelectorEvents', () => {
  it('dispatches a force-close event even when CustomEvent is unavailable', () => {
    stubWindowProperty('CustomEvent', undefined)
    const listener = vi.fn((event: Event) => {
      expect(getResourceSelectorForceCloseSource(event)).toBe('selector-a')
    })

    window.addEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, listener)
    try {
      requestCloseResourceSelectors('selector-a')
    } finally {
      window.removeEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, listener)
    }

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('falls back to timers when microtask or animation-frame APIs are unavailable', async () => {
    stubWindowProperty('queueMicrotask', undefined)
    stubWindowProperty('requestAnimationFrame', undefined)
    stubWindowProperty('cancelAnimationFrame', undefined)
    const listener = vi.fn()

    window.addEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, listener)
    try {
      const cancel = scheduleCloseTransientResourceSelectors()

      expect(listener).toHaveBeenCalledTimes(1)
      await new Promise((resolve) => window.setTimeout(resolve, 25))
      expect(listener.mock.calls.length).toBeGreaterThan(1)

      cancel?.()
    } finally {
      window.removeEventListener(RESOURCE_SELECTOR_FORCE_CLOSE_EVENT, listener)
    }
  })
})
